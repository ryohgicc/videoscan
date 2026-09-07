import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import OpenAI from 'openai';

const app = express();
const port = Number(process.env.PORT || 3333);
const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const uploadDir = path.join(rootDir, 'uploads');
const publicDir = path.join(rootDir, 'public');
const envPath = path.join(rootDir, '.env');
const historyPath = path.join(dataDir, 'history.jsonl');
const analysisHistoryPath = path.join(dataDir, 'analysis-history.jsonl');
const collectorHistoryPath = path.join(dataDir, 'collector-history.jsonl');
const collectorDir = path.join(dataDir, 'collector');
const collectorStatePath = path.join(collectorDir, 'latest-session.json');
const mediaCrawlerDir = path.join(rootDir, 'MediaCrawler');
const xhsDownloaderFallbackDir = path.join(rootDir, 'XHS-Downloader');
const jobs = new Map();
const pendingJobs = [];
const collectorSessions = new Map();
let activeJobCount = 0;

await fsp.mkdir(dataDir, { recursive: true });
await fsp.mkdir(uploadDir, { recursive: true });
await fsp.mkdir(collectorDir, { recursive: true });

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 1024 * 1024 * 500 },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

app.get('/api/config', async (_req, res) => {
  const config = getPublicConfig();
  res.json({
    ...config,
    asrBackend: process.env.ASR_BACKEND || 'faster-whisper',
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    hasAIDouyinKey: Boolean(process.env.AI_DOUYIN_API_KEY),
    hasTikHubToken: Boolean(process.env.TIKHUB_TOKEN),
    ffmpegAvailable: await commandExists('ffmpeg'),
  });
});

app.post('/api/config', async (req, res) => {
  const updates = pickConfigUpdates(req.body || {});
  await saveEnvUpdates(updates);
  Object.assign(process.env, updates);
  res.json({ ok: true, config: getPublicConfig() });
});

app.post('/api/test-llm', async (_req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) throw new Error('缺少 API Key。');
    const client = createOpenAIClient();
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: '你只需要回答 OK。' },
        { role: 'user', content: '连接测试' },
      ],
      max_tokens: 8,
      temperature: 0,
    });
    res.json({
      ok: true,
      message: response.choices?.[0]?.message?.content?.trim() || 'OK',
      model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/test-asr', async (_req, res) => {
  try {
    if ((process.env.ASR_BACKEND || 'faster-whisper').toLowerCase() !== 'volcengine') {
      return res.json({ ok: true, message: '当前不是火山模式，未执行火山 API 检测。' });
    }
    const apiKey = process.env.VOLCENGINE_API_KEY;
    if (!apiKey) throw new Error('缺少火山引擎 API Key。');
    const result = await volcengineSubmitProbe({
      apiKey,
      resourceId: process.env.VOLCENGINE_RESOURCE_ID || 'volc.seedasr.auc',
      baseUrl: process.env.VOLCENGINE_ASR_BASE || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel',
    });
    res.json({ ok: true, message: `已返回 task_id: ${result.taskId}` });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: [...jobs.values()].map(publicJob).sort((a, b) => b.createdAt - a.createdAt) });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  res.json({ job: publicJob(job) });
});

app.get('/api/history', async (_req, res) => {
  res.json({ history: await readHistory() });
});

app.get('/api/history/analysis', async (_req, res) => {
  res.json({ analyses: await readAnalysisHistory() });
});

app.delete('/api/history/:jobId', async (req, res) => {
  const result = await deleteHistoryEntry(req.params.jobId);
  if (!result.deleted) return res.status(404).json({ ok: false, error: 'history_not_found' });
  res.json({ ok: true, deleted: result.deleted, history: result.history });
});

app.delete('/api/history/analysis/:analysisId', async (req, res) => {
  const result = await deleteAnalysisHistoryEntry(req.params.analysisId);
  if (!result.deleted) return res.status(404).json({ ok: false, error: 'analysis_history_not_found' });
  res.json({ ok: true, deleted: result.deleted, analyses: result.analyses });
});

app.post('/api/extension/capture', (req, res) => {
  try {
    const url = normalizeInputUrl(req.body?.url || req.body?.pageUrl || '');
    if (!url) return res.status(400).json({ ok: false, error: '没有识别到可处理的视频链接。' });
    if (!isDouyinUrl(url) && !isXhsUrl(url) && !isDirectMediaUrl(url)) {
      return res.status(400).json({ ok: false, error: '当前只支持抖音、小红书或媒体直链。' });
    }
    const pageTitle = String(req.body?.pageTitle || '').trim();
    const job = createJob({
      type: 'extension',
      source: url,
      originalName: pageTitle ? `${pageTitle} · ${url}` : url,
      pageUrl: String(req.body?.pageUrl || '').trim(),
    });
    addJobLog(job, '来自浏览器插件的一键采集');
    enqueueJob(job, () => processLinkJob(job, url));
    res.json({ ok: true, job: publicJob(job) });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/history/analyze', async (req, res) => {
  try {
    const purpose = String(req.body?.purpose || '').trim();
    const requestedIds = Array.isArray(req.body?.jobIds) ? req.body.jobIds.map(String) : [];
    if (!purpose) return res.status(400).json({ ok: false, error: '请填写分析目的。' });
    if (!requestedIds.length) return res.status(400).json({ ok: false, error: '请至少选择一条历史记录。' });
    if (!process.env.OPENAI_API_KEY) return res.status(400).json({ ok: false, error: '缺少 OPENAI_API_KEY，请先在设置里配置 LLM。' });

    const maxItems = getHistoryAnalysisMaxItems();
    const maxChars = getHistoryAnalysisMaxChars();
    const history = await readHistory();
    const selected = requestedIds
      .slice(0, maxItems)
      .map((id) => history.find((item) => item.jobId === id))
      .filter(Boolean);
    if (!selected.length) return res.status(404).json({ ok: false, error: '没有找到选中的历史记录。' });

    const analysis = await analyzeHistoryRecords(purpose, selected, { maxChars });
    const analysisEntry = {
      analysisId: crypto.randomUUID(),
      purpose,
      analysis,
      usedItems: selected.length,
      maxItems,
      maxChars,
      sourceJobIds: selected.map((item) => item.jobId),
      sourceHistory: selected.map((item) => cloneHistoryRecord(item)),
      createdAt: Date.now(),
    };
    await appendAnalysisHistory(analysisEntry);
    res.json({ ok: true, analysis, analysisEntry, usedItems: selected.length, maxItems, maxChars });
  } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/collector/session', async (_req, res) => {
  const session = await readLatestCollectorSession();
  res.json({ session });
});

app.get('/api/collector/session/:sessionId', async (req, res) => {
  const session = await readCollectorSession(req.params.sessionId);
  if (!session) return res.status(404).json({ ok: false, error: 'collector_session_not_found' });
  res.json({ session });
});

app.get('/api/collector/history', async (_req, res) => {
  res.json({ history: await readCollectorHistory() });
});

app.delete('/api/collector/history/:sessionId', async (req, res) => {
  const result = await deleteCollectorHistoryEntry(req.params.sessionId);
  if (!result.deleted) return res.status(404).json({ ok: false, error: 'collector_history_not_found' });
  res.json({ ok: true, deleted: result.deleted, history: result.history });
});

app.post('/api/collector/run', async (req, res) => {
  try {
    const keywords = normalizeLines(req.body?.keywords);
    const platforms = normalizeLines(req.body?.platforms).filter((item) => ['dy', 'xhs'].includes(item));
    const limitPerKeyword = clampNumber(req.body?.limitPerKeyword, 20, 1, 100);
    const retries = clampNumber(req.body?.retries, 2, 0, 5);
    if (!keywords.length) return res.status(400).json({ ok: false, error: '请先输入关键词。' });
    if (!platforms.length) return res.status(400).json({ ok: false, error: '请至少选择一个平台。' });
    if (!await directoryExists(mediaCrawlerDir)) {
      return res.status(400).json({ ok: false, error: '未找到本地 MediaCrawler 目录。请先克隆到项目根目录。' });
    }

    const session = {
      id: crypto.randomUUID(),
      status: 'running',
      keywords,
      platforms,
      limitPerKeyword,
      retries,
      createdAt: Date.now(),
      finishedAt: null,
      items: [],
      logs: [],
      progress: {
        done: 0,
        total: keywords.length * platforms.length,
        label: '准备开始',
      },
    };
    collectorSessions.set(session.id, session);
    await saveCollectorSession(session);
    void runCollectorSession(session, { limitPerKeyword, retries });
    res.json({ ok: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/collector/submit', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const session = await readCollectorSession(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'collector_session_not_found' });
    const items = session.items.filter((item) => ids.includes(item.id));
    if (!items.length) return res.status(400).json({ ok: false, error: 'no_selected_items' });

    const created = items.map((item) => {
      const job = createJob({
        type: 'collector',
        source: item.url,
        originalName: item.title ? `${item.title} · ${item.author || ''}`.trim() : item.url,
        sourceKeywords: item.keywords || [],
      });
      enqueueJob(job, () => processLinkJob(job, item.url, { sourceKeywords: item.keywords || [] }));
      return job;
    });

    session.logs.push(`已提交 ${created.length} 条到转写队列`);
    await saveCollectorSession(session);
    res.json({ ok: true, jobs: created });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/collector/selection', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const session = await readCollectorSession(sessionId);
    if (!session) return res.status(404).json({ ok: false, error: 'collector_session_not_found' });

    const selected = new Set(ids);
    session.items = session.items.map((item) => ({
      ...item,
      selected: selected.has(item.id),
    }));
    await saveCollectorSession(session);
    res.json({ ok: true, session });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(400).json({ ok: false, error: message });
  }
});

app.post('/api/jobs/links', (req, res) => {
  const rawLinks = Array.isArray(req.body.links) ? req.body.links : [];
  const links = [...new Set(rawLinks.map((item) => normalizeInputUrl(item)).filter(Boolean))];
  if (!links.length) return res.status(400).json({ error: 'no_links' });

  const created = links.map((url) => {
    const job = createJob({ type: 'link', source: url, originalName: url });
    enqueueJob(job, () => processLinkJob(job, url));
    return job;
  });
  res.json({ jobs: created });
});

app.post('/api/jobs/files', upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'no_files' });

  const created = files.map((file) => {
    const job = createJob({
      type: 'file',
      source: file.path,
      originalName: file.originalname,
      filePath: file.path,
    });
    enqueueJob(job, () => processFileJob(job, file.path, file.originalname));
    return job;
  });
  res.json({ jobs: created });
});

app.get('/api/jobs/:id/download/:kind', async (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send('job_not_found');

  const file = {
    text: job.outputs?.textPath,
    srt: job.outputs?.srtPath,
    audio: job.outputs?.audioPath,
    video: job.outputs?.videoPath,
  }[req.params.kind];

  if (!file) return res.status(404).send('file_not_found');
  res.download(file);
});

app.listen(port, () => {
  console.log(`VideoScan running at http://localhost:${port}`);
});

function createJob(input) {
  const id = crypto.randomUUID();
  const job = {
    id,
    ...input,
    status: 'queued',
    progress: '等待处理',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    updatedAt: Date.now(),
    outputs: {},
    logs: [],
  };
  jobs.set(id, job);
  return job;
}

function enqueueJob(job, runner) {
  pendingJobs.push({ job, runner });
  addJobLog(job, '任务已进入等待队列');
  updateJob(job, { status: 'queued', progress: '等待处理' });
  scheduleJobs();
}

function scheduleJobs() {
  const limit = getMaxConcurrentJobs();
  while (activeJobCount < limit && pendingJobs.length) {
    const item = pendingJobs.shift();
    activeJobCount += 1;
    addJobLog(item.job, `开始执行，并发 ${activeJobCount}/${getMaxConcurrentJobs()}`);
    item.runner()
      .catch((error) => failJob(item.job, error))
      .finally(() => {
        activeJobCount -= 1;
        scheduleJobs();
      });
  }
}

function getMaxConcurrentJobs() {
  const value = Number(process.env.MAX_CONCURRENT_JOBS || 2);
  if (!Number.isFinite(value)) return 2;
  return Math.min(8, Math.max(1, Math.floor(value)));
}

function getHistoryAnalysisMaxItems() {
  const value = Number(process.env.HISTORY_ANALYSIS_MAX_ITEMS || 10);
  if (!Number.isFinite(value)) return 10;
  return Math.min(10, Math.max(1, Math.floor(value)));
}

function getHistoryAnalysisMaxChars() {
  const value = Number(process.env.HISTORY_ANALYSIS_MAX_CHARS || 6000);
  if (!Number.isFinite(value)) return 6000;
  return Math.min(30000, Math.max(500, Math.floor(value)));
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeLines(value) {
  if (Array.isArray(value)) return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  return [...new Set(String(value || '').split(/\n+/).map((line) => line.trim()).filter(Boolean))];
}

async function directoryExists(dirPath) {
  try {
    const stat = await fsp.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function runMediaCrawlerSearch({ platform, keyword, limitPerKeyword, retries, session }) {
  const attempts = Math.max(1, retries + 1);
  const savePath = path.join(collectorDir, session.id, platform, sanitizeFilePart(keyword));
  await fsp.mkdir(savePath, { recursive: true });
  const python = process.env.XHS_PYTHON || process.env.MEDIA_CRAWLER_PYTHON || 'python3';
  const cookie = process.env.XHS_COOKIE || '';
  const proxy = process.env.DOUYIN_PROXY || '';
  const loginType = cookie ? 'cookie' : 'qrcode';

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      session.logs.push(`[${platform}] ${keyword} 第 ${attempt} 次采集`);
      await saveCollectorSession(session);
      await runCommand(python, [
        'main.py',
        '--platform',
        platform,
        '--lt',
        loginType,
        '--type',
        'search',
        '--save_data_option',
        'jsonl',
        '--save_data_path',
        savePath,
        '--get_comment',
        'false',
        '--get_sub_comment',
        'false',
        '--crawler_max_notes_count',
        String(limitPerKeyword),
        '--keywords',
        keyword,
        '--headless',
        'false',
        ...(cookie ? ['--cookies', cookie] : []),
        ...(proxy ? ['--enable_ip_proxy', 'true', '--ip_proxy_provider_name', 'static', '--static_proxy_url', proxy] : []),
      ], {
        cwd: mediaCrawlerDir,
        session,
        label: `crawler-${platform}-${attempt}`,
        timeoutMs: 1000 * 60 * 20,
      });
      return await readCollectorItems(savePath, platform, keyword);
    } catch (error) {
      lastError = error;
      session.logs.push(`[${platform}] ${keyword} 第 ${attempt} 次失败：${error instanceof Error ? error.message : String(error)}`);
      await saveCollectorSession(session);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || '采集失败'));
}

async function runCollectorSession(session, options) {
  const seen = new Set();
  try {
    session.status = 'running';
    session.progress = session.progress || { done: 0, total: session.keywords.length * session.platforms.length, label: '准备开始' };
    session.logs = session.logs || [];
    await saveCollectorSession(session);

    let done = 0;
    for (const platform of session.platforms) {
      for (const keyword of session.keywords) {
        session.progress = {
          done,
          total: session.progress.total || session.keywords.length * session.platforms.length,
          label: `${platform === 'dy' ? '抖音' : '小红书'} · ${keyword}`,
        };
        addCollectorLog(session, `开始采集：${session.progress.label}`);
        await saveCollectorSession(session);

        const attemptItems = await runMediaCrawlerSearch({
          platform,
          keyword,
          limitPerKeyword: options.limitPerKeyword,
          retries: options.retries,
          session,
        });

        for (const item of attemptItems) {
          const key = item.url || `${item.platform}:${item.title}:${item.author}`;
          if (seen.has(key)) continue;
          seen.add(key);
          session.items.push(item);
        }

        done += 1;
        session.progress = {
          done,
          total: session.progress.total || session.keywords.length * session.platforms.length,
          label: `${platform === 'dy' ? '抖音' : '小红书'} · ${keyword}`,
        };
        addCollectorLog(session, `完成采集：${session.progress.label}，累计 ${session.items.length} 条`);
        await saveCollectorSession(session);
      }
    }

    session.status = 'done';
    session.finishedAt = Date.now();
    session.progress = {
      done: session.progress.total || session.keywords.length * session.platforms.length,
      total: session.progress.total || session.keywords.length * session.platforms.length,
      label: '采集完成',
    };
    addCollectorLog(session, '采集完成。');
    await saveCollectorSession(session);
    await appendCollectorHistory(session);
  } catch (error) {
    session.status = 'failed';
    session.finishedAt = Date.now();
    session.error = error instanceof Error ? error.message : String(error);
    addCollectorLog(session, `采集失败：${session.error}`);
    await saveCollectorSession(session);
    await appendCollectorHistory(session);
  }
}

async function readCollectorItems(savePath, platform, keyword) {
  const files = await collectJsonlFiles(savePath);
  const items = [];
  for (const file of files) {
    const content = await fsp.readFile(file, 'utf8').catch(() => '');
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const raw = JSON.parse(line);
        const item = normalizeCollectorItem(platform, keyword, raw);
        if (item) items.push(item);
      } catch {
        continue;
      }
    }
  }
  return items;
}

async function collectJsonlFiles(dirPath) {
  const results = [];
  async function walk(current) {
    const entries = await fsp.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.includes('_contents_')) {
        results.push(full);
      }
    }
  }
  await walk(dirPath);
  return results;
}

function normalizeCollectorItem(platform, keyword, raw) {
  const url = String(raw?.aweme_url || raw?.note_url || raw?.url || '').trim();
  const title = String(raw?.title || raw?.desc || '').trim();
  if (!url || !title) return null;

  const metrics = platform === 'dy'
    ? {
      playCount: numberOrNull(raw?.play_count),
      likeCount: numberOrNull(raw?.liked_count),
      commentCount: numberOrNull(raw?.comment_count),
      collectCount: numberOrNull(raw?.collected_count),
      shareCount: numberOrNull(raw?.share_count),
    }
    : {
      playCount: numberOrNull(raw?.play_count),
      likeCount: numberOrNull(raw?.liked_count),
      commentCount: numberOrNull(raw?.comment_count),
      collectCount: numberOrNull(raw?.collected_count),
      shareCount: numberOrNull(raw?.share_count),
    };

  return {
    id: crypto.randomUUID(),
    platform,
    platformLabel: platform === 'dy' ? '抖音' : '小红书',
    keyword,
    keywords: String(raw?.source_keyword || keyword || '').split(',').map((item) => item.trim()).filter(Boolean),
    title,
    author: String(raw?.nickname || raw?.author || '').trim(),
    url,
    metrics,
    raw,
    selected: true,
    status: 'preview',
  };
}

function sanitizeFilePart(value) {
  return String(value || 'keyword').replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 80) || 'keyword';
}

async function saveCollectorSession(session) {
  session.logs = Array.isArray(session.logs) ? session.logs.slice(-200) : [];
  const filePath = path.join(collectorDir, `${session.id}.json`);
  await fsp.writeFile(filePath, `${JSON.stringify(session, null, 2)}\n`, 'utf8');
  await fsp.writeFile(collectorStatePath, `${JSON.stringify({ latestSessionId: session.id }, null, 2)}\n`, 'utf8');
}

async function readCollectorSession(sessionId) {
  if (!sessionId) return readLatestCollectorSession();
  if (collectorSessions.has(sessionId)) return collectorSessions.get(sessionId);
  const filePath = path.join(collectorDir, `${sessionId}.json`);
  try {
    const session = JSON.parse(await fsp.readFile(filePath, 'utf8'));
    collectorSessions.set(sessionId, session);
    return session;
  } catch {
    return null;
  }
}

async function readLatestCollectorSession() {
  try {
    const state = JSON.parse(await fsp.readFile(collectorStatePath, 'utf8'));
    if (state?.latestSessionId) {
      const session = await readCollectorSession(state.latestSessionId);
      if (session) return session;
    }
  } catch {
    return { id: '', status: 'idle', keywords: [], platforms: [], loginType: 'qrcode', python: 'python3', cookie: '', items: [], logs: [], progress: { done: 0, total: 0, label: '' } };
  }
  return { id: '', status: 'idle', keywords: [], platforms: [], loginType: 'qrcode', python: 'python3', cookie: '', items: [], logs: [], progress: { done: 0, total: 0, label: '' } };
}

async function readCollectorHistory() {
  let content = '';
  try {
    content = await fsp.readFile(collectorHistoryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.savedAt || b.finishedAt || 0) - (a.savedAt || a.finishedAt || 0));
}

async function deleteCollectorHistoryEntry(sessionId) {
  const history = await readCollectorHistory();
  const next = history.filter((item) => item.sessionId !== sessionId);
  const deleted = history.length - next.length;
  if (!deleted) return { deleted: 0, history };
  await writeCollectorHistory(next);
  await fsp.unlink(path.join(collectorDir, `${sessionId}.json`)).catch(() => {});
  collectorSessions.delete(sessionId);
  return { deleted, history: next };
}

function addCollectorLog(session, line) {
  session.logs = [...(session.logs || []), `[${formatCollectorTime(Date.now())}] ${line}`].slice(-200);
}

function formatCollectorTime(ts) {
  return new Date(Number(ts || Date.now())).toLocaleTimeString('zh-CN', { hour12: false });
}

async function processLinkJob(job, url, jobMeta = {}) {
  url = normalizeInputUrl(url);
  updateJob(job, { source: url, originalName: url });
  addJobLog(job, `解析链接：${url}`);
  updateJob(job, { status: 'running', progress: '解析视频链接' });
  const workDir = await ensureJobDir(job.id);

  let videoPath;
  let meta = {};
  if (isDirectMediaUrl(url)) {
    updateJob(job, { progress: '下载媒体直链' });
    videoPath = path.join(workDir, `media${path.extname(new URL(url).pathname) || '.mp4'}`);
    await downloadFile(url, videoPath);
  } else if ((process.env.VIDEO_INFO_PROVIDER || 'local-tools').toLowerCase() === 'local-tools') {
    videoPath = await downloadWithLocalTool(job, url, workDir);
  } else {
    const resolved = await resolveVideoUrl(url);
    await writeJson(path.join(workDir, 'resolved.json'), resolved);
    updateJob(job, { progress: '下载视频' });
    videoPath = path.join(workDir, 'video.mp4');
    await downloadFirstWorkingCandidate(resolved.download_urls || [resolved.download_url], videoPath);
    meta = { title: resolved.title, author: resolved.author };
  }

  await processMedia(job, videoPath, workDir, { ...jobMeta, videoPath });
}

async function processFileJob(job, filePath, originalName) {
  updateJob(job, { status: 'running', progress: '准备本地文件' });
  addJobLog(job, `准备本地文件：${originalName || filePath}`);
  const workDir = await ensureJobDir(job.id);
  const ext = path.extname(originalName || filePath).toLowerCase();
  const inputPath = path.join(workDir, `input${ext || path.extname(filePath) || '.media'}`);
  await fsp.copyFile(filePath, inputPath);
  await processMedia(job, inputPath, workDir, { originalName });
}

async function processMedia(job, mediaPath, workDir, meta = {}) {
  const manifest = await findManifestForMedia(workDir, mediaPath);
  if (manifest) {
    meta = {
      ...meta,
      title: meta.title || manifest.desc,
      author: meta.author || manifest.author_name,
      metrics: extractMetrics(manifest),
      awemeId: manifest.aweme_id,
    };
  }
  const title = meta.title || extractTitleFromMediaPath(mediaPath) || meta.originalName || job.originalName || job.source;
  addJobLog(job, `媒体文件：${mediaPath}`);
  const audioPath = await ensureAudio(job, mediaPath, workDir);
  updateJob(job, { progress: '语音转文字' });
  addJobLog(job, `开始本地转写：${audioPath}`);
  const transcript = await transcribeAudio(job, audioPath, workDir);

  let summary = '';
  if ((process.env.ENABLE_SUMMARY || 'true') === 'true' && process.env.OPENAI_API_KEY) {
    updateJob(job, { progress: '整理摘要' });
    summary = await summarizeTranscript(transcript.text, meta);
  }

  const deletedVideoPath = await maybeDeleteVideo(mediaPath, audioPath, workDir);
  if (deletedVideoPath) addJobLog(job, `已删除视频文件：${deletedVideoPath}`);
  updateJob(job, {
    status: 'done',
    progress: '完成',
    title,
    metrics: meta.metrics || {},
    transcript: transcript.text,
    summary,
    outputs: {
      ...job.outputs,
      ...transcript.outputs,
      audioPath,
      videoPath: deletedVideoPath ? null : meta.videoPath,
      deletedVideoPath,
    },
  });
  await appendHistory({
    jobId: job.id,
    source: job.source,
    originalName: job.originalName,
    sourceKeywords: meta.sourceKeywords || job.sourceKeywords || [],
    title,
    metrics: meta.metrics || {},
    transcript: transcript.text,
    summary,
    durationMs: job.durationMs,
    deletedVideoPath,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  });
}

async function findManifestForMedia(workDir, mediaPath) {
  const manifestPath = path.join(workDir, 'download_manifest.jsonl');
  let records = [];
  try {
    const content = await fsp.readFile(manifestPath, 'utf8');
    records = content.split(/\r?\n/).filter(Boolean).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return null;
  }
  const relative = path.relative(workDir, mediaPath);
  return [...records].reverse().find((record) => {
    const paths = Array.isArray(record.file_paths) ? record.file_paths : [];
    const names = Array.isArray(record.file_names) ? record.file_names : [];
    return paths.some((item) => normalizePathFragment(item) === normalizePathFragment(relative))
      || names.includes(path.basename(mediaPath));
  }) || records.at(-1) || null;
}

function normalizePathFragment(value) {
  return String(value || '').replaceAll('\\', '/');
}

function extractMetrics(record) {
  const stats = record?.statistics || {};
  return {
    likeCount: numberOrNull(stats.digg_count ?? stats.like_count),
    commentCount: numberOrNull(stats.comment_count),
    collectCount: numberOrNull(stats.collect_count),
    shareCount: numberOrNull(stats.share_count),
    playCount: numberOrNull(stats.play_count ?? stats.play_count_str),
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(number) ? number : null;
}

async function maybeDeleteVideo(mediaPath, audioPath, workDir) {
  if ((process.env.DELETE_VIDEO_AFTER_TRANSCRIBE || 'true') !== 'true') return null;
  if (!mediaPath || mediaPath === audioPath) return null;
  if (!isPathInside(mediaPath, workDir)) return null;
  const ext = path.extname(mediaPath).toLowerCase();
  if (!['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'].includes(ext)) return null;
  await fsp.unlink(mediaPath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return mediaPath;
}

async function ensureAudio(job, mediaPath, workDir) {
  const ext = path.extname(mediaPath).toLowerCase();
  if (['.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.webm'].includes(ext)) {
    addJobLog(job, '输入已经是音频，跳过 ffmpeg 提取');
    updateJob(job, { outputs: { ...job.outputs, audioPath: mediaPath } });
    return mediaPath;
  }

  updateJob(job, { progress: '提取音频' });
  addJobLog(job, '开始用 ffmpeg 提取音频');
  const audioPath = path.join(workDir, 'audio.mp3');
  await runCommand('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mediaPath, '-vn', '-acodec', 'libmp3lame', '-q:a', '2', audioPath], { job, label: 'ffmpeg' });
  return audioPath;
}

async function transcribeAudio(job, audioPath, workDir) {
  const backend = (process.env.ASR_BACKEND || 'faster-whisper').toLowerCase();
  if (backend === 'faster-whisper') return transcribeWithFasterWhisper(job, audioPath, workDir);
  if (backend === 'volcengine') return transcribeWithVolcengine(job, audioPath, workDir);
  return transcribeWithOpenAI(job, audioPath, workDir);
}

async function transcribeWithOpenAI(job, audioPath, workDir) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('缺少 OPENAI_API_KEY，或者把 ASR_BACKEND 改成 faster-whisper。');
  }

  addJobLog(job, '调用 OpenAI 兼容音频转写接口');
  const client = createOpenAIClient();
  const result = await client.audio.transcriptions.create({
    file: fs.createReadStream(audioPath),
    model: process.env.OPENAI_TRANSCRIBE_MODEL || 'whisper-1',
    response_format: 'verbose_json',
  });

  const text = String(result.text || '').trim();
  const textPath = path.join(workDir, 'text.txt');
  const srtPath = path.join(workDir, 'subtitle.srt');
  await fsp.writeFile(textPath, `${text}\n`, 'utf8');
  await fsp.writeFile(srtPath, segmentsToSrt(result.segments || [], text), 'utf8');
  return { text, outputs: { textPath, srtPath } };
}

async function transcribeWithVolcengine(job, audioPath, workDir) {
  const apiKey = process.env.VOLCENGINE_API_KEY;
  if (!apiKey) throw new Error('缺少火山引擎 API Key，请先在设置里填写。');

  addJobLog(job, '调用火山引擎 ASR 标准版接口');
  const volcengineAudioPath = path.join(workDir, 'volcengine-audio.wav');
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    audioPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'pcm_s16le',
    volcengineAudioPath,
  ], { job, label: 'ffmpeg-asr' });
  const audioBytes = await fsp.readFile(volcengineAudioPath);
  const result = await volcengineTranscribe(audioBytes, {
    apiKey,
    resourceId: process.env.VOLCENGINE_RESOURCE_ID || 'volc.seedasr.auc',
    baseUrl: process.env.VOLCENGINE_ASR_BASE || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel',
    job,
  });

  const text = String(result.text || '').trim();
  const textPath = path.join(workDir, 'text.txt');
  const srtPath = path.join(workDir, 'subtitle.srt');
  await fsp.writeFile(textPath, `${text}\n`, 'utf8');
  await fsp.writeFile(srtPath, result.segments?.length ? segmentsToSrt(result.segments, text) : segmentsToSrt([], text), 'utf8');
  return { text, outputs: { textPath, srtPath } };
}

async function transcribeWithFasterWhisper(job, audioPath, workDir) {
  const scriptPath = path.join(rootDir, 'scripts', 'transcribe_faster_whisper.py');
  const python = process.env.FW_PYTHON || 'python3';
  await runCommand(python, [
    scriptPath,
    audioPath,
    '--output-dir',
    workDir,
    '--model-size',
    process.env.FW_MODEL_SIZE || 'small',
    '--device',
    process.env.FW_DEVICE || 'auto',
  ], {
    job,
    label: 'whisper',
    env: process.env.HF_ENDPOINT ? { HF_ENDPOINT: process.env.HF_ENDPOINT } : {},
  });
  const textPath = path.join(workDir, 'text.txt');
  const srtPath = path.join(workDir, 'subtitle.srt');
  const text = await fsp.readFile(textPath, 'utf8');
  return { text: text.trim(), outputs: { textPath, srtPath } };
}

async function summarizeTranscript(text, meta) {
  if (!text.trim()) return '';
  const client = createOpenAIClient();
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: '你是中文视频内容整理助手。基于转写文本输出简洁标题、摘要和要点，不补充原文没有的信息。',
      },
      {
        role: 'user',
        content: [
          `标题参考：${meta.title || meta.originalName || ''}`,
          `作者参考：${meta.author || ''}`,
          '转写文本：',
          text.slice(0, 24000),
          '',
          '请用 Markdown 输出：标题、摘要、核心要点。',
        ].join('\n'),
      },
    ],
    temperature: 0.2,
  });
  return response.choices?.[0]?.message?.content?.trim() || '';
}

async function analyzeHistoryRecords(purpose, records, options = {}) {
  const maxChars = options.maxChars || getHistoryAnalysisMaxChars();
  const client = createOpenAIClient();
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: [
          '你是中文短视频脚本与增长分析顾问。',
          '你的任务是分析用户选中的视频转写稿，提炼脚本结构、宣传利益点、用户痛点、开头钩子和可复用表达。',
          '只基于用户提供的标题、链接、指标和转写文本分析，不要编造不存在的数据。',
          '输出 Markdown，结论要具体、可执行，避免空泛鸡汤。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: buildHistoryAnalysisPrompt(purpose, records, maxChars),
      },
    ],
    temperature: 0.25,
  });
  return response.choices?.[0]?.message?.content?.trim() || '';
}

function buildHistoryAnalysisPrompt(purpose, records, maxChars) {
  return [
    `我的分析目的：${purpose}`,
    '',
    '请综合分析下面这些视频脚本和宣传利益点，并按这个结构输出：',
    '1. 总体结论：这些视频共同在卖什么、承诺什么结果。',
    '2. 脚本结构拆解：开头钩子、问题铺垫、解决方案、证明/示例、行动号召。',
    '3. 宣传利益点：列出高频利益点，并说明它们对应的用户痛点。',
    '4. 单条视频亮点：逐条指出每条脚本最值得复用的点。',
    '5. 数据线索：结合播放、点赞、评论、收藏、分享数据，谨慎推测哪些角度可能更有效；如果数据缺失就说明无法判断。',
    '6. 可复用脚本模板：给出 3 个可以直接改写的新脚本框架。',
    '7. 下一步建议：我应该优先测试哪些选题、利益点和表达方式。',
    '',
    '选中的历史记录：',
    ...records.map((record, index) => formatHistoryRecordForPrompt(record, index + 1, maxChars)),
  ].join('\n');
}

function formatHistoryRecordForPrompt(record, index, maxChars) {
  const transcript = String(record.transcript || '').trim();
  const clipped = transcript.length > maxChars
    ? `${transcript.slice(0, maxChars)}\n[已截断，原文共 ${transcript.length} 字]`
    : transcript;
  return [
    '',
    `## 视频 ${index}`,
    `标题：${record.title || record.originalName || '无标题'}`,
    `原链接：${record.source || ''}`,
    `指标：${formatMetricsForPrompt(record.metrics)}`,
    '文字稿：',
    clipped || '无文字稿',
  ].join('\n');
}

function formatMetricsForPrompt(metrics = {}) {
  const parts = [
    ['播放', metrics.playCount],
    ['点赞', metrics.likeCount],
    ['评论', metrics.commentCount],
    ['收藏', metrics.collectCount],
    ['分享', metrics.shareCount],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (!parts.length) return '无';
  return parts.map(([label, value]) => `${label} ${value}`).join('，');
}

function createOpenAIClient() {
  const options = { apiKey: process.env.OPENAI_API_KEY };
  if (process.env.OPENAI_API_BASE) options.baseURL = process.env.OPENAI_API_BASE;
  return new OpenAI(options);
}

async function volcengineTranscribe(audioBytes, options) {
  const submitUrl = `${String(options.baseUrl || '').replace(/\/$/, '')}/submit`;
  const queryUrl = `${String(options.baseUrl || '').replace(/\/$/, '')}/query`;
  const requestId = crypto.randomUUID();
  const audioFormat = inferVolcengineAudioFormat(audioBytes);
  const submitBody = buildVolcengineSubmitBody(audioBytes, audioFormat);
  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': options.apiKey,
      'X-Api-Resource-Id': options.resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(submitBody),
  });
  const submitPayload = await submitResponse.json().catch(() => ({}));
  const submitStatus = submitResponse.headers.get('X-Api-Status-Code') || '';
  if (!submitResponse.ok || (submitStatus && submitStatus !== '20000000')) {
    throw new Error(formatVolcengineError('火山引擎提交失败', submitResponse, submitPayload));
  }

  const taskId = submitPayload.task_id || submitPayload.taskId || submitPayload.request_id || submitPayload.requestId || requestId;
  addJobLog(options.job, `火山 ASR 已提交：${taskId}`);

  for (let i = 0; i < 60; i += 1) {
    await wait(3000);
    const queryResponse = await fetch(queryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': options.apiKey,
        'X-Api-Resource-Id': options.resourceId,
        'X-Api-Request-Id': taskId,
      },
      body: JSON.stringify({}),
    });
    const queryPayload = await queryResponse.json().catch(() => ({}));
    const queryStatus = queryResponse.headers.get('X-Api-Status-Code') || '';
    if (!queryResponse.ok) throw new Error(formatVolcengineError('火山引擎查询失败', queryResponse, queryPayload));
    const statusCode = String(queryPayload?.header?.code || queryStatus || queryPayload.code || '').trim();
    if (i === 0 || i % 5 === 4 || statusCode === '20000000' || statusCode === '0') {
      addJobLog(options.job, `火山 ASR 查询状态：${statusCode || 'unknown'}`);
    }
    if (statusCode === '20000000' || statusCode === '0') {
      const text = extractVolcengineText(queryPayload);
      addJobLog(options.job, `火山 ASR 返回文本：${text.length} 字`);
      return { text, segments: extractVolcengineSegments(queryPayload) };
    }
    if (statusCode === '20000001' || statusCode === '20000002') continue;
    if (statusCode && statusCode !== '20000001' && statusCode !== '20000002') {
      throw new Error(formatVolcengineError('火山引擎转写失败', queryResponse, queryPayload));
    }
    const text = extractVolcengineText(queryPayload);
    if (text) {
      return { text, segments: extractVolcengineSegments(queryPayload) };
    }
  }

  throw new Error('火山引擎转写超时。');
}

async function volcengineSubmitProbe(options) {
  const submitUrl = `${String(options.baseUrl || '').replace(/\/$/, '')}/submit`;
  const requestId = crypto.randomUUID();
  const audioBytes = createSilentWavBuffer(1);
  const submitResponse = await fetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': options.apiKey,
      'X-Api-Resource-Id': options.resourceId,
      'X-Api-Request-Id': requestId,
      'X-Api-Sequence': '-1',
    },
    body: JSON.stringify(buildVolcengineSubmitBody(audioBytes, 'wav')),
  });
  const submitPayload = await submitResponse.json().catch(() => ({}));
  const submitStatus = submitResponse.headers.get('X-Api-Status-Code') || '';
  if (!submitResponse.ok || (submitStatus && submitStatus !== '20000000')) {
    throw new Error(formatVolcengineError('火山引擎提交检测失败', submitResponse, submitPayload));
  }
  return { taskId: requestId };
}

function buildVolcengineSubmitBody(audioBytes, audioFormat) {
  return {
    user: { uid: 'videoscan' },
    audio: {
      data: audioBytes.toString('base64'),
      format: audioFormat,
      codec: 'raw',
      rate: 16000,
      bits: 16,
      channel: 1,
    },
    request: {
      model_name: 'bigmodel',
      enable_itn: true,
      enable_punc: (process.env.VOLCENGINE_ENABLE_PUNC || 'true') === 'true',
      enable_ddc: false,
      enable_speaker_info: false,
      enable_channel_split: false,
      show_utterances: true,
      vad_segment: false,
      sensitive_words_filter: '',
    },
  };
}

function extractVolcengineText(payload) {
  return String(
    payload?.text
    || payload?.result?.[0]?.text
    || payload?.result?.text
    || payload?.result?.utterances?.map((item) => item.text).filter(Boolean).join('')
    || payload?.utterances?.map((item) => item.text).filter(Boolean).join('')
    || payload?.resp?.text
    || '',
  ).trim();
}

function extractVolcengineSegments(payload) {
  const list = payload?.result?.utterances || payload?.utterances || payload?.resp?.utterances || [];
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    start: Number(item.start_time || item.start || 0) / 1000,
    end: Number(item.end_time || item.end || item.start_time || 0) / 1000,
    text: item.text || '',
  })).filter((item) => item.text);
}

function formatVolcengineError(prefix, response, payload) {
  const headerCode = response.headers.get('X-Api-Status-Code') || '';
  const headerMessage = response.headers.get('X-Api-Message') || '';
  const bodyCode = payload?.header?.code || payload?.code || payload?.resp?.code || '';
  const bodyMessage = payload?.header?.message || payload?.message || payload?.error || payload?.resp?.message || '';
  const detail = [
    `HTTP ${response.status}`,
    headerCode ? `header_code=${headerCode}` : '',
    headerMessage ? `header_message=${headerMessage}` : '',
    bodyCode ? `body_code=${bodyCode}` : '',
    bodyMessage ? `body_message=${bodyMessage}` : '',
  ].filter(Boolean).join('，');
  return `${prefix}：${detail || 'unknown_error'}`;
}

function inferVolcengineAudioFormat(audioBytes) {
  if (audioBytes.length >= 12 && audioBytes.slice(0, 4).toString('ascii') === 'RIFF' && audioBytes.slice(8, 12).toString('ascii') === 'WAVE') {
    return 'wav';
  }
  if (audioBytes.length >= 3 && audioBytes.slice(0, 3).toString('ascii') === 'ID3') return 'mp3';
  return 'mp3';
}

function createSilentWavBuffer(durationSeconds = 1, sampleRate = 16000) {
  const channels = 1;
  const bitsPerSample = 16;
  const samples = Math.max(1, Math.floor(durationSeconds * sampleRate));
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples * blockAlign;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPublicConfig() {
  return {
    asrBackend: process.env.ASR_BACKEND || 'faster-whisper',
    openaiApiBase: process.env.OPENAI_API_BASE || '',
    localWhisperModel: process.env.FW_MODEL_SIZE || 'small',
    openaiSummaryModel: process.env.OPENAI_SUMMARY_MODEL || 'gpt-4o-mini',
    enableSummary: (process.env.ENABLE_SUMMARY || 'true') === 'true',
    deleteVideoAfterTranscribe: (process.env.DELETE_VIDEO_AFTER_TRANSCRIBE || 'true') === 'true',
    maxConcurrentJobs: getMaxConcurrentJobs(),
    historyAnalysisMaxItems: getHistoryAnalysisMaxItems(),
    historyAnalysisMaxChars: getHistoryAnalysisMaxChars(),
    videoInfoProvider: process.env.VIDEO_INFO_PROVIDER || 'local-tools',
    douyinDownloaderDir: process.env.DOUYIN_DOWNLOADER_DIR || '',
    douyinPython: process.env.DOUYIN_PYTHON || 'python3',
    douyinProxy: process.env.DOUYIN_PROXY || '',
    douyinInsecureTls: (process.env.DOUYIN_INSECURE_TLS || '') === '1',
    volcengineResourceId: process.env.VOLCENGINE_RESOURCE_ID || 'volc.seedasr.auc',
    volcengineAsrBase: process.env.VOLCENGINE_ASR_BASE || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel',
    volcengineEnablePunc: (process.env.VOLCENGINE_ENABLE_PUNC || 'true') === 'true',
    maskedVolcengineApiKey: maskSecret(process.env.VOLCENGINE_API_KEY || ''),
    xhsDownloaderDir: process.env.XHS_DOWNLOADER_DIR || '',
    xhsPython: process.env.XHS_PYTHON || 'python3',
    xhsCookie: maskSecret(process.env.XHS_COOKIE || ''),
    xhsDownloaderResolvedDir: '',
    hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
    maskedOpenAIKey: maskSecret(process.env.OPENAI_API_KEY || ''),
  };
}

function pickConfigUpdates(body) {
  const schema = {
    openaiApiKey: 'OPENAI_API_KEY',
    openaiApiBase: 'OPENAI_API_BASE',
    asrBackend: 'ASR_BACKEND',
    localWhisperModel: 'FW_MODEL_SIZE',
    openaiSummaryModel: 'OPENAI_SUMMARY_MODEL',
    enableSummary: 'ENABLE_SUMMARY',
    deleteVideoAfterTranscribe: 'DELETE_VIDEO_AFTER_TRANSCRIBE',
    maxConcurrentJobs: 'MAX_CONCURRENT_JOBS',
    historyAnalysisMaxItems: 'HISTORY_ANALYSIS_MAX_ITEMS',
    historyAnalysisMaxChars: 'HISTORY_ANALYSIS_MAX_CHARS',
    videoInfoProvider: 'VIDEO_INFO_PROVIDER',
    douyinDownloaderDir: 'DOUYIN_DOWNLOADER_DIR',
    douyinPython: 'DOUYIN_PYTHON',
    douyinProxy: 'DOUYIN_PROXY',
    douyinInsecureTls: 'DOUYIN_INSECURE_TLS',
    volcengineApiKey: 'VOLCENGINE_API_KEY',
    volcengineResourceId: 'VOLCENGINE_RESOURCE_ID',
    volcengineAsrBase: 'VOLCENGINE_ASR_BASE',
    volcengineEnablePunc: 'VOLCENGINE_ENABLE_PUNC',
    xhsDownloaderDir: 'XHS_DOWNLOADER_DIR',
    xhsPython: 'XHS_PYTHON',
    xhsCookie: 'XHS_COOKIE',
  };
  const updates = {};
  for (const [inputKey, envKey] of Object.entries(schema)) {
    if (!(inputKey in body)) continue;
    if (inputKey === 'enableSummary' || inputKey === 'deleteVideoAfterTranscribe' || inputKey === 'volcengineEnablePunc') {
      updates[envKey] = body[inputKey] ? 'true' : 'false';
    } else if (inputKey === 'douyinInsecureTls') {
      updates[envKey] = body[inputKey] ? '1' : '0';
    } else if (inputKey === 'asrBackend') {
      updates[envKey] = String(body[inputKey] || 'faster-whisper').trim();
    } else if (inputKey === 'maxConcurrentJobs') {
      updates[envKey] = String(Math.min(8, Math.max(1, Math.floor(Number(body[inputKey]) || 2))));
    } else if (inputKey === 'historyAnalysisMaxItems') {
      updates[envKey] = String(Math.min(10, Math.max(1, Math.floor(Number(body[inputKey]) || 10))));
    } else if (inputKey === 'historyAnalysisMaxChars') {
      updates[envKey] = String(Math.min(30000, Math.max(500, Math.floor(Number(body[inputKey]) || 6000))));
    } else {
      const value = String(body[inputKey] || '').trim();
      if (!value) continue;
      updates[envKey] = value;
    }
  }
  return updates;
}

async function saveEnvUpdates(updates) {
  const existing = await readEnvLines(envPath);
  const seen = new Set();
  const remaining = existing.filter((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match) return true;
    if (match[1] in updates) return false;
    if (seen.has(match[1])) return false;
    seen.add(match[1]);
    return true;
  });
  const additions = Object.entries(updates).map(([key, value]) => `${key}=${quoteEnvValue(value)}`);
  const content = [...remaining, ...additions].join('\n').replace(/\n*$/, '\n');
  await fsp.writeFile(envPath, content, 'utf8');
}

async function readEnvLines(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    return content.split(/\r?\n/).filter((line, index, lines) => line || index < lines.length - 1);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function appendHistory(entry) {
  const payload = {
    ...entry,
    savedAt: Date.now(),
  };
  await fsp.appendFile(historyPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function appendAnalysisHistory(entry) {
  const payload = {
    ...entry,
    savedAt: Date.now(),
  };
  await fsp.appendFile(analysisHistoryPath, `${JSON.stringify(payload)}\n`, 'utf8');
}

async function readHistory() {
  let content = '';
  try {
    content = await fsp.readFile(historyPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

async function readAnalysisHistory() {
  let content = '';
  try {
    content = await fsp.readFile(analysisHistoryPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.createdAt || b.savedAt || 0) - (a.createdAt || a.savedAt || 0));
}

async function appendCollectorHistory(session) {
  const payload = {
    sessionId: session.id,
    status: session.status,
    keywords: session.keywords || [],
    platforms: session.platforms || [],
    limitPerKeyword: session.limitPerKeyword || 20,
    retries: session.retries ?? 2,
    itemCount: Array.isArray(session.items) ? session.items.length : 0,
    createdAt: session.createdAt || Date.now(),
    finishedAt: session.finishedAt || Date.now(),
    savedAt: Date.now(),
  };
  const history = await readCollectorHistory();
  const next = [payload, ...history.filter((item) => item.sessionId !== payload.sessionId)];
  await writeCollectorHistory(next);
}

async function writeHistory(items) {
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  await fsp.writeFile(historyPath, content ? `${content}\n` : '', 'utf8');
}

async function deleteHistoryEntry(jobId) {
  const history = await readHistory();
  const next = history.filter((item) => item.jobId !== jobId);
  const deleted = history.length - next.length;
  if (!deleted) return { deleted: 0, history };
  await writeHistory(next);
  return { deleted, history: next };
}

async function writeAnalysisHistory(items) {
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  await fsp.writeFile(analysisHistoryPath, content ? `${content}\n` : '', 'utf8');
}

async function writeCollectorHistory(items) {
  const content = items.map((item) => JSON.stringify(item)).join('\n');
  await fsp.writeFile(collectorHistoryPath, content ? `${content}\n` : '', 'utf8');
}

async function deleteAnalysisHistoryEntry(analysisId) {
  const analyses = await readAnalysisHistory();
  const next = analyses.filter((item) => item.analysisId !== analysisId);
  const deleted = analyses.length - next.length;
  if (!deleted) return { deleted: 0, analyses };
  await writeAnalysisHistory(next);
  return { deleted, analyses: next };
}

function cloneHistoryRecord(record) {
  return {
    jobId: record.jobId,
    source: record.source,
    originalName: record.originalName,
    title: record.title,
    metrics: record.metrics || {},
    transcript: record.transcript || '',
    summary: record.summary || '',
    durationMs: record.durationMs || 0,
    deletedVideoPath: record.deletedVideoPath || null,
    createdAt: record.createdAt || null,
    finishedAt: record.finishedAt || null,
  };
}

function quoteEnvValue(value) {
  const text = String(value ?? '');
  if (!text || /[\s#"'\\]/.test(text)) return JSON.stringify(text);
  return text;
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function resolveVideoUrl(url) {
  url = normalizeInputUrl(url);
  const provider = (process.env.VIDEO_INFO_PROVIDER || 'ai-douyin').toLowerCase();
  if (provider === 'tikhub') return resolveWithTikHub(url);
  return resolveWithAIDouyin(url);
}

async function downloadWithLocalTool(job, url, workDir) {
  const startedAt = Date.now();
  const before = await snapshotFiles(workDir);
  let toolOutput = '';
  if (isXhsUrl(url)) {
    toolOutput = await downloadWithXhsTool(job, url, workDir);
  } else if (isDouyinUrl(url)) {
    toolOutput = await downloadWithDouyinTool(job, url, workDir);
  } else {
    throw new Error('local-tools 目前只支持抖音和小红书链接；其他平台请上传文件或使用媒体直链。');
  }
  const media = await findNewestMediaFile(workDir, before, startedAt) || await waitForMediaFile(workDir, before, startedAt);
  if (!media) throw new Error(`本地下载器运行完成，但没有找到下载出的音视频文件。\n\n${summarizeToolOutput(toolOutput)}`);
  return media;
}

async function downloadWithDouyinTool(job, url, workDir) {
  const toolDir = process.env.DOUYIN_DOWNLOADER_DIR;
  if (!toolDir) throw new Error('缺少 DOUYIN_DOWNLOADER_DIR。请先 clone jiji262/douyin-downloader 并安装依赖。');
  updateJob(job, { progress: '调用本地抖音下载器' });
  return runCommand(process.env.DOUYIN_PYTHON || 'python3', [
    path.join(toolDir, 'run.py'),
    '-u',
    url,
    '-p',
    workDir,
    '--show-warnings',
  ], {
    job,
    label: 'douyin',
    cwd: toolDir,
    env: {
      ...(process.env.DOUYIN_PROXY ? { DOUYIN_PROXY: process.env.DOUYIN_PROXY } : {}),
      ...(process.env.DOUYIN_INSECURE_TLS === '1' ? { DOUYIN_INSECURE_TLS: '1' } : {}),
    },
  });
}

async function downloadWithXhsTool(job, url, workDir) {
  const toolDir = await resolveXhsDownloaderDir();
  if (!toolDir) throw new Error('缺少 XHS_DOWNLOADER_DIR。请先 clone JoeanAmier/XHS-Downloader 并安装依赖。');
  updateJob(job, { progress: '调用本地小红书下载器' });
  const args = [
    path.join(toolDir, 'main.py'),
    '--url',
    url,
    '--work_path',
    workDir,
    '--folder_name',
    '',
    '--image_format',
    'WEBP',
    '--download_record',
    'false',
    '--language',
    'zh_CN',
  ];
  if (process.env.XHS_COOKIE) args.push('--cookie', process.env.XHS_COOKIE);
  return runCommand(process.env.XHS_PYTHON || 'python3', args, { cwd: toolDir, job, label: 'xhs' });
}

async function resolveXhsDownloaderDir() {
  const configured = String(process.env.XHS_DOWNLOADER_DIR || '').trim();
  if (configured && await directoryExists(configured)) return configured;
  if (await directoryExists(xhsDownloaderFallbackDir)) return xhsDownloaderFallbackDir;
  return configured;
}

async function resolveWithAIDouyin(url) {
  const apiKey = process.env.AI_DOUYIN_API_KEY;
  if (!apiKey) throw new Error('缺少 AI_DOUYIN_API_KEY，链接解析需要 AI Douyin 或 TikHub。');

  const base = process.env.AI_DOUYIN_API_BASE || 'https://top9.cc';
  const endpoint = buildAIDouyinEndpoint(base);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({ url }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI Douyin 解析失败 HTTP ${response.status}: ${payload.message || payload.error || 'unknown_error'}`);
  const normalized = normalizeResolvedPayload(payload);
  if (!normalized.download_url) throw new Error('AI Douyin 没有返回 download_url。');
  return normalized;
}

async function resolveWithTikHub(url) {
  const token = process.env.TIKHUB_TOKEN;
  if (!token) throw new Error('缺少 TIKHUB_TOKEN。');
  const encoded = encodeURIComponent(url);
  const endpoint = url.includes('xiaohongshu') || url.includes('xhslink')
    ? `https://api.tikhub.io/api/v1/xiaohongshu/web/get_note_info_v7?share_text=${encoded}`
    : `https://api.tikhub.io/api/v1/hybrid/video_data?url=${encoded}&minimal=true`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`TikHub 解析失败 HTTP ${response.status}: ${payload.message || payload.error || 'unknown_error'}`);
  const normalized = normalizeResolvedPayload(payload);
  if (!normalized.download_url) throw new Error('TikHub 没有返回可下载视频直链。');
  return normalized;
}

function normalizeResolvedPayload(payload) {
  const candidates = [
    payload.download_url,
    ...(Array.isArray(payload.download_urls) ? payload.download_urls : []),
    payload.data?.video_data?.nwm_video_url,
    payload.data?.video?.play_addr?.url_list?.[0],
    payload.data?.video_data?.video?.play_addr?.url_list?.[0],
  ].filter(Boolean).map(String);

  return {
    ...payload,
    download_url: candidates[0],
    download_urls: [...new Set(candidates)],
    title: payload.title || payload.desc || payload.data?.title || payload.data?.desc,
    author: payload.author || payload.nickname || payload.data?.author?.nickname,
  };
}

function buildAIDouyinEndpoint(base) {
  if (base.endsWith('/api/v1')) return `${base}/video/download-url`;
  if (base.endsWith('/api')) return `${base}/v1/video/download-url`;
  return `${base.replace(/\/$/, '')}/api/v1/video/download-url`;
}

function isDouyinUrl(url) {
  return /douyin\.com|iesdouyin\.com|tiktok\.com/i.test(url);
}

function normalizeInputUrl(url) {
  const text = extractFirstUrl(String(url || '').trim());
  try {
    const parsed = new URL(text);
    if (isDouyinUrl(text)) {
      const modalId = parsed.searchParams.get('modal_id');
      const videoId = parsed.pathname.match(/\/video\/(\d{8,})/)?.[1];
      const id = modalId || videoId;
      if (id && /^\d{8,}$/.test(id)) return `https://www.douyin.com/video/${id}`;
    }
    if (isXhsUrl(text)) {
      const noteId = parsed.pathname.match(/\/explore\/([A-Za-z0-9]+)/)?.[1];
      if (noteId) {
        const normalized = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
        const xsecToken = parsed.searchParams.get('xsec_token');
        if (xsecToken) normalized.searchParams.set('xsec_token', xsecToken);
        return normalized.href;
      }
    }
  } catch {
    return text;
  }
  return text;
}

function extractTitleFromMediaPath(mediaPath) {
  const stem = path.basename(mediaPath, path.extname(mediaPath));
  return stem
    .replace(/_\d{12,}$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}_/, '')
    .replace(/[_*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPathInside(filePath, dirPath) {
  const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s"'<>，。；！？、【】《》]+/i);
  return (match ? match[0] : text).trim();
}

function isXhsUrl(url) {
  return /xiaohongshu\.com|xhslink\.(com|cn)|rednote\.com/i.test(url);
}

function isDirectMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return /\.(mp4|mov|m4v|mp3|wav|m4a|flac|aac|ogg|webm)(\?|$)/i.test(parsed.pathname + parsed.search);
  } catch {
    return false;
  }
}

async function snapshotFiles(dir) {
  const files = await listFiles(dir);
  return new Set(files);
}

async function findNewestMediaFile(dir, before = new Set(), startedAt = 0) {
  const mediaExts = new Set(['.mp4', '.mov', '.m4v', '.mp3', '.wav', '.m4a', '.flac', '.aac', '.ogg', '.webm']);
  const files = await listFiles(dir);
  const candidates = [];
  for (const file of files) {
    if (before.has(file)) continue;
    if (!isMediaCandidate(file, mediaExts)) continue;
    const stat = await fsp.stat(file);
    if (startedAt && stat.mtimeMs < startedAt - 1000) continue;
    if (stat.size > 0) candidates.push({ file, mtimeMs: stat.mtimeMs, size: stat.size });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.size - a.size);
  return candidates[0]?.file;
}

async function waitForMediaFile(dir, before = new Set(), startedAt = 0) {
  for (let i = 0; i < 20; i += 1) {
    const media = await findNewestMediaFile(dir, before, startedAt);
    if (media) return media;
    await wait(1500);
  }
  return null;
}

function isMediaCandidate(file, mediaExts) {
  const ext = path.extname(file).toLowerCase();
  if (mediaExts.has(ext)) return true;
  return [...mediaExts].some((suffix) => String(file).toLowerCase().endsWith(`${suffix}.tmp`));
}

async function listFiles(dir) {
  const output = [];
  async function walk(current) {
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile()) output.push(fullPath);
    }
  }
  await walk(dir);
  return output;
}

async function downloadFirstWorkingCandidate(candidates, outputPath) {
  const clean = (candidates || []).filter(Boolean);
  if (!clean.length) throw new Error('没有可下载候选地址。');
  const errors = [];
  for (const candidate of clean) {
    try {
      await downloadFile(candidate, outputPath);
      return;
    } catch (error) {
      errors.push(error.message);
    }
  }
  throw new Error(`候选地址全部下载失败：${errors.join('; ')}`);
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/134.0.0.0 Safari/537.36',
    },
  });
  if (!response.ok || !response.body) throw new Error(`下载失败 HTTP ${response.status}`);
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(outputPath);
    Readable.fromWeb(response.body).pipe(fileStream);
    fileStream.on('finish', resolve);
    fileStream.on('error', reject);
  });
}

function segmentsToSrt(segments, fallbackText) {
  if (!Array.isArray(segments) || !segments.length) {
    return fallbackText ? `1\n00:00:00,000 --> 00:00:01,000\n${fallbackText}\n\n` : '';
  }
  return segments.map((segment, index) => {
    const start = secondsToSrt(segment.start || 0);
    const end = secondsToSrt(segment.end || segment.start || 1);
    return `${index + 1}\n${start} --> ${end}\n${String(segment.text || '').trim()}\n`;
  }).join('\n');
}

function secondsToSrt(seconds) {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${String(millis).padStart(3, '0')}`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

async function ensureJobDir(id) {
  const dir = path.join(dataDir, id);
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

function updateJob(job, patch) {
  if (patch.status === 'running' && !job.startedAt) {
    patch.startedAt = Date.now();
  }
  if (['done', 'failed'].includes(patch.status) && !patch.finishedAt) {
    patch.finishedAt = Date.now();
  }
  if (patch.finishedAt && job.startedAt) {
    patch.durationMs = patch.finishedAt - job.startedAt;
  }
  Object.assign(job, patch, { updatedAt: Date.now() });
  jobs.set(job.id, job);
}

function addJobLog(job, message) {
  if (!job) return;
  const line = `[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${message}`;
  job.logs = [...(job.logs || []), line].slice(-300);
  job.updatedAt = Date.now();
  jobs.set(job.id, job);
}

function publicJob(job) {
  const durationMs = job.durationMs ?? (job.startedAt ? Date.now() - job.startedAt : 0);
  return {
    ...job,
    durationMs,
  };
}

function failJob(job, error) {
  updateJob(job, {
    status: 'failed',
    progress: '失败',
    error: error instanceof Error ? error.message : String(error),
  });
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    if (options.job) addJobLog(options.job, `执行命令：${options.label || command}`);
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env || {}) },
      cwd: options.cwd || rootDir,
    });
    let stderr = '';
    let stdout = '';
    let timeoutId = null;
    if (options.timeoutMs) {
      timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
        reject(new Error(`${command} timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
      timeoutId.unref?.();
    }
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendProcessLogs(options.job, options.label || command, text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendProcessLogs(options.job, options.label || command, text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (timeoutId) clearTimeout(timeoutId);
      const output = `${stdout}\n${stderr}`.trim();
      if (code === 0) {
        if (options.job) addJobLog(options.job, `命令完成：${options.label || command}`);
        resolve(output);
      } else {
        reject(new Error(`${command} exited ${code}: ${(stderr || stdout).trim()}`));
      }
    });
  });
}

function appendProcessLogs(job, label, text) {
  if (!job || !text) return;
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim();
    if (cleaned) addJobLog(job, `[${label}] ${cleaned}`);
  }
}

function summarizeToolOutput(output) {
  const lines = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const important = lines.filter((line) => /ERROR|WARNING|失败|风控|anti-bot|risk|Cookie|登录|403|Empty 200/i.test(line));
  return (important.length ? important : lines).slice(-12).join('\n');
}

async function commandExists(command) {
  const paths = (process.env.PATH || '').split(path.delimiter);
  const extensions = os.platform() === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of paths) {
    for (const ext of extensions) {
      try {
        await fsp.access(path.join(dir, command + ext), fs.constants.X_OK);
        return true;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return false;
}

async function writeJson(filePath, value) {
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}
