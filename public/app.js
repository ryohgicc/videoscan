const jobsEl = document.querySelector('#jobs');
const historyEl = document.querySelector('#history');
const configStatusEl = document.querySelector('#configStatus');
const linksEl = document.querySelector('#links');
const filesEl = document.querySelector('#files');
const configMessageEl = document.querySelector('#configMessage');
const settingsDialog = document.querySelector('#settingsDialog');
const asrBackendEl = document.querySelector('#asrBackend');
const analysisPurposeEl = document.querySelector('#analysisPurpose');
const analysisMessageEl = document.querySelector('#analysisMessage');
const analysisResultEl = document.querySelector('#analysisResult');
let currentConfig = {};

document.querySelector('#submitLinks').addEventListener('click', submitLinks);
document.querySelector('#submitFiles').addEventListener('click', submitFiles);
document.querySelector('#refresh').addEventListener('click', loadJobs);
document.querySelector('#exportMarkdown').addEventListener('click', exportMarkdown);
document.querySelector('#refreshHistory').addEventListener('click', loadHistory);
document.querySelector('#selectAllHistory').addEventListener('click', selectAllHistory);
document.querySelector('#clearHistorySelection').addEventListener('click', clearHistorySelection);
document.querySelector('#analyzeHistory').addEventListener('click', analyzeSelectedHistory);
document.querySelector('#copyAnalysis').addEventListener('click', copyAnalysis);
document.querySelector('#openSettings').addEventListener('click', openSettings);
document.querySelector('#saveConfig').addEventListener('click', saveConfig);
document.querySelector('#testSummaryLlm').addEventListener('click', testSummaryLlm);
document.querySelector('#testAsrApi').addEventListener('click', testAsrApi);

let jobs = [];
let historyItems = [];
let selectedHistoryIds = new Set();
let lastAnalysisText = '';
let pollTimer = null;

await loadConfig();
await loadJobs();
await loadHistory();
switchTab(location.hash.replace('#', '') || 'current');
startPolling();

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
}

window.addEventListener('hashchange', () => switchTab(location.hash.replace('#', '') || 'current'));
asrBackendEl.addEventListener('change', updateAsrModeVisibility);

async function loadConfig() {
  const response = await fetch('/api/config');
  const config = await response.json();
  currentConfig = config;
  fillConfigForm(config);
  const checks = [
    `ASR: ${config.asrBackend}`,
    config.hasOpenAIKey ? 'OpenAI 已配置' : 'OpenAI 未配置',
    config.ffmpegAvailable ? 'ffmpeg 可用' : 'ffmpeg 未安装',
    config.hasAIDouyinKey || config.hasTikHubToken ? 'API 解析已配置' : '本地解析模式',
  ];
  configStatusEl.textContent = checks.join(' · ');
}

function fillConfigForm(config) {
  document.querySelector('#openaiApiKey').value = '';
  document.querySelector('#openaiApiKey').placeholder = config.maskedOpenAIKey || '********';
  document.querySelector('#openaiApiBase').value = config.openaiApiBase || '';
  document.querySelector('#asrBackend').value = config.asrBackend || 'faster-whisper';
  document.querySelector('#localWhisperModel').value = config.localWhisperModel || 'small';
  document.querySelector('#openaiSummaryModel').value = config.openaiSummaryModel || 'gpt-4o-mini';
  document.querySelector('#maxConcurrentJobs').value = config.maxConcurrentJobs || 2;
  document.querySelector('#historyAnalysisMaxItems').value = config.historyAnalysisMaxItems || 10;
  document.querySelector('#historyAnalysisMaxChars').value = config.historyAnalysisMaxChars || 6000;
  document.querySelector('#douyinDownloaderDir').value = config.douyinDownloaderDir || '';
  document.querySelector('#douyinPython').value = config.douyinPython || 'python3';
  document.querySelector('#douyinProxy').value = config.douyinProxy || '';
  document.querySelector('#douyinInsecureTls').checked = Boolean(config.douyinInsecureTls);
  document.querySelector('#volcengineApiKey').value = '';
  document.querySelector('#volcengineApiKey').placeholder = config.maskedVolcengineApiKey || '********';
  document.querySelector('#volcengineResourceId').value = config.volcengineResourceId || 'volc.seedasr.auc';
  document.querySelector('#volcengineAsrBase').value = config.volcengineAsrBase || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel';
  document.querySelector('#xhsDownloaderDir').value = config.xhsDownloaderDir || '';
  document.querySelector('#xhsPython').value = config.xhsPython || 'python3';
  document.querySelector('#enableSummary').checked = Boolean(config.enableSummary);
  document.querySelector('#deleteVideoAfterTranscribe').checked = Boolean(config.deleteVideoAfterTranscribe);
  updateAsrModeVisibility();
}

function openSettings() {
  configMessageEl.textContent = '';
  settingsDialog.showModal();
}

async function saveConfig(options = {}) {
  const button = document.querySelector('#saveConfig');
  button.disabled = true;
  if (!options.quiet) configMessageEl.textContent = '保存中...';
  const payload = {
    openaiApiBase: document.querySelector('#openaiApiBase').value,
    asrBackend: document.querySelector('#asrBackend').value,
    localWhisperModel: document.querySelector('#localWhisperModel').value,
    openaiSummaryModel: document.querySelector('#openaiSummaryModel').value,
    maxConcurrentJobs: document.querySelector('#maxConcurrentJobs').value,
    historyAnalysisMaxItems: document.querySelector('#historyAnalysisMaxItems').value,
    historyAnalysisMaxChars: document.querySelector('#historyAnalysisMaxChars').value,
    enableSummary: document.querySelector('#enableSummary').checked,
    deleteVideoAfterTranscribe: document.querySelector('#deleteVideoAfterTranscribe').checked,
    videoInfoProvider: 'local-tools',
    douyinDownloaderDir: document.querySelector('#douyinDownloaderDir').value,
    douyinPython: document.querySelector('#douyinPython').value,
    douyinProxy: document.querySelector('#douyinProxy').value,
    douyinInsecureTls: document.querySelector('#douyinInsecureTls').checked,
    volcengineResourceId: document.querySelector('#volcengineResourceId').value,
    volcengineAsrBase: document.querySelector('#volcengineAsrBase').value,
    xhsDownloaderDir: document.querySelector('#xhsDownloaderDir').value,
    xhsPython: document.querySelector('#xhsPython').value,
  };
  const openaiApiKey = document.querySelector('#openaiApiKey').value.trim();
  if (openaiApiKey) payload.openaiApiKey = openaiApiKey;
  const volcengineApiKey = document.querySelector('#volcengineApiKey').value.trim();
  if (volcengineApiKey) payload.volcengineApiKey = volcengineApiKey;
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  button.disabled = false;
  if (!response.ok) {
    configMessageEl.textContent = '保存失败';
    return false;
  }
  const payloadResult = await response.json().catch(() => ({}));
  document.querySelector('#openaiApiKey').value = '';
  document.querySelector('#volcengineApiKey').value = '';
  configMessageEl.textContent = options.quiet ? configMessageEl.textContent : '已保存到 .env';
  if (payloadResult.config) fillConfigForm(payloadResult.config);
  await loadConfig();
  if (!options.stayOpen) {
    window.setTimeout(() => settingsDialog.close(), 500);
  }
  return true;
}

function updateAsrModeVisibility() {
  const volcVisible = asrBackendEl.value === 'volcengine';
  for (const input of ['#volcengineApiKey', '#volcengineResourceId', '#volcengineAsrBase']) {
    const label = document.querySelector(`${input}`).closest('label');
    if (label) label.style.display = volcVisible ? '' : 'none';
  }
}

async function testSummaryLlm() {
  const button = document.querySelector('#testSummaryLlm');
  button.disabled = true;
  configMessageEl.textContent = '测试摘要 LLM 连接中...';
  const saved = await saveConfig({ stayOpen: true, quiet: true });
  if (!saved) {
    button.disabled = false;
    return;
  }
  const response = await fetch('/api/test-llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  button.disabled = false;
  configMessageEl.textContent = payload.ok ? `摘要 LLM 连接正常：${payload.message}` : `摘要 LLM 连接失败：${payload.error || '未知错误'}`;
}

async function testAsrApi() {
  const button = document.querySelector('#testAsrApi');
  button.disabled = true;
  configMessageEl.textContent = '测试语音识别 API 连接中...';
  const saved = await saveConfig({ stayOpen: true, quiet: true });
  if (!saved) {
    button.disabled = false;
    return;
  }
  const response = await fetch('/api/test-asr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  button.disabled = false;
  configMessageEl.textContent = payload.ok
    ? `语音识别 API 连接正常：${payload.message}`
    : `语音识别 API 连接失败：${payload.error || '未知错误'}`;
}

async function submitLinks() {
  const links = linksEl.value.split(/\n+/).map((line) => normalizeInputUrl(line)).filter(Boolean);
  if (!links.length) return;
  await fetch('/api/jobs/links', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ links }),
  });
  linksEl.value = '';
  await loadJobs();
  startPolling();
}

function normalizeInputUrl(value) {
  const text = extractFirstUrl(String(value || '').trim());
  try {
    const url = new URL(text);
    if (/douyin\.com|iesdouyin\.com|tiktok\.com/i.test(text)) {
      const modalId = url.searchParams.get('modal_id');
      if (modalId && /^\d{8,}$/.test(modalId)) {
        return `https://www.douyin.com/video/${modalId}`;
      }
    }
  } catch {
    return text;
  }
  return text;
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s"'<>，。；！？、【】《》]+/i);
  return (match ? match[0] : text).trim();
}

async function submitFiles() {
  if (!filesEl.files.length) return;
  const form = new FormData();
  for (const file of filesEl.files) form.append('files', file);
  await fetch('/api/jobs/files', { method: 'POST', body: form });
  filesEl.value = '';
  await loadJobs();
  startPolling();
}

async function loadJobs() {
  const response = await fetch('/api/jobs');
  const payload = await response.json();
  jobs = payload.jobs || [];
  renderJobs();
}

async function loadHistory() {
  const response = await fetch('/api/history');
  const payload = await response.json();
  historyItems = payload.history || [];
  selectedHistoryIds = new Set([...selectedHistoryIds].filter((id) => historyItems.some((item) => item.jobId === id)));
  renderHistory();
}

function renderJobs() {
  if (!jobs.length) {
    jobsEl.innerHTML = '<p class="meta">还没有任务。</p>';
    return;
  }

  jobsEl.innerHTML = jobs.map((job) => {
    const body = job.status === 'failed'
      ? `<div class="result">${escapeHtml(job.error || '未知错误')}</div>`
      : resultHtml(job);
    return `
      <article class="job">
        <div class="job-head">
          <div>
            <div class="source">${escapeHtml(job.originalName || job.source || job.id)}</div>
            <div class="meta">${escapeHtml(job.progress || '')} · ${formatDuration(job.durationMs || 0)}${transcriptCountMeta(job.transcript)}</div>
          </div>
          <span class="badge ${job.status}">${labelStatus(job.status)}</span>
        </div>
        ${metricsHtml(job.metrics)}
        ${body}
        ${logsHtml(job)}
        ${actionsHtml(job)}
      </article>
    `;
  }).join('');

  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', () => copyJob(button.dataset.copy));
  }
}

function logsHtml(job) {
  const logs = job.logs || [];
  if (!logs.length) return '';
  return `
    <details class="log-block" ${job.status === 'running' ? 'open' : ''}>
      <summary>实时日志</summary>
      <pre>${escapeHtml(logs.join('\n'))}</pre>
    </details>
  `;
}

function renderHistory() {
  if (!historyItems.length) {
    historyEl.innerHTML = '<p class="meta">还没有历史记录。</p>';
    return;
  }

  historyEl.innerHTML = historyItems.map((item) => `
    <article class="job">
      <div class="job-head">
        <label class="history-select">
          <input type="checkbox" data-history-select="${escapeAttribute(item.jobId)}" ${selectedHistoryIds.has(item.jobId) ? 'checked' : ''}>
          <span>
            <span class="source">${escapeHtml(item.title || item.source || item.jobId)}</span>
            <span class="meta">${escapeHtml(item.source || '')} · ${formatDuration(item.durationMs || 0)}${transcriptCountMeta(item.transcript)}</span>
          </span>
        </label>
        <span class="badge done">历史</span>
      </div>
      ${metricsHtml(item.metrics)}
      <div class="result-label">音频原文</div>
      <div class="result transcript-result">${escapeHtml(item.transcript || '')}</div>
      <div class="job-actions">
        <button class="secondary" data-history-copy="${escapeAttribute(item.jobId)}">复制原文</button>
        <button class="secondary danger" data-history-delete="${escapeAttribute(item.jobId)}">删除</button>
      </div>
    </article>
  `).join('');

  for (const button of document.querySelectorAll('[data-history-copy]')) {
    button.addEventListener('click', () => copyHistory(button.dataset.historyCopy));
  }
  for (const button of document.querySelectorAll('[data-history-delete]')) {
    button.addEventListener('click', () => deleteHistory(button.dataset.historyDelete));
  }
  for (const input of document.querySelectorAll('[data-history-select]')) {
    input.addEventListener('change', () => {
      if (input.checked) selectedHistoryIds.add(input.dataset.historySelect);
      else selectedHistoryIds.delete(input.dataset.historySelect);
      updateAnalysisMessage();
    });
  }
  updateAnalysisMessage();
}

async function copyHistory(jobId) {
  const item = historyItems.find((entry) => entry.jobId === jobId);
  if (!item) return;
  await navigator.clipboard.writeText(item.transcript || '');
}

async function deleteHistory(jobId) {
  const item = historyItems.find((entry) => entry.jobId === jobId);
  if (!item) return;
  const title = item.title || item.source || jobId;
  if (!window.confirm(`删除这条历史记录？\n${title}`)) return;
  const response = await fetch(`/api/history/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  if (!response.ok) {
    updateAnalysisMessage('删除失败。');
    return;
  }
  selectedHistoryIds.delete(jobId);
  await loadHistory();
  updateAnalysisMessage('已删除历史记录。');
}

function selectAllHistory() {
  const max = Number(document.querySelector('#historyAnalysisMaxItems').value || 10);
  selectedHistoryIds = new Set(historyItems.slice(0, max).map((item) => item.jobId));
  renderHistory();
}

function clearHistorySelection() {
  selectedHistoryIds = new Set();
  renderHistory();
}

function updateAnalysisMessage(message = '') {
  if (message) {
    analysisMessageEl.textContent = message;
    return;
  }
  const count = selectedHistoryIds.size;
  const max = document.querySelector('#historyAnalysisMaxItems').value || 10;
  analysisMessageEl.textContent = count ? `已选择 ${count}/${max} 条历史记录` : `最多选择 ${max} 条历史记录`;
}

async function analyzeSelectedHistory() {
  const button = document.querySelector('#analyzeHistory');
  const purpose = analysisPurposeEl.value.trim();
  const jobIds = [...selectedHistoryIds];
  if (!purpose) {
    updateAnalysisMessage('请先输入分析目的。');
    return;
  }
  if (!jobIds.length) {
    updateAnalysisMessage('请先勾选需要分析的历史记录。');
    return;
  }
  button.disabled = true;
  updateAnalysisMessage('正在调用 LLM 分析...');
  const response = await fetch('/api/history/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose, jobIds }),
  });
  const payload = await response.json().catch(() => ({}));
  button.disabled = false;
  if (!response.ok || !payload.ok) {
    updateAnalysisMessage(`分析失败：${payload.error || '未知错误'}`);
    return;
  }
  lastAnalysisText = payload.analysis || '';
  analysisResultEl.textContent = lastAnalysisText || 'AI 没有返回内容。';
  updateAnalysisMessage(`分析完成，共 ${payload.usedItems || jobIds.length} 条。`);
  switchTab('analysis');
}

async function copyAnalysis() {
  if (!lastAnalysisText) return;
  await navigator.clipboard.writeText(lastAnalysisText);
}

function switchTab(name) {
  if (!['current', 'history', 'analysis'].includes(name)) name = 'current';
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  document.querySelector('#currentView').classList.toggle('active', name === 'current');
  document.querySelector('#historyView').classList.toggle('active', name === 'history');
  document.querySelector('#analysisView').classList.toggle('active', name === 'analysis');
  if (name === 'history') loadHistory();
  if (location.hash !== `#${name}`) {
    history.replaceState(null, '', `#${name}`);
  }
}

function resultHtml(job) {
  if (job.transcript) {
    const summary = job.summary
      ? `<details class="summary-block"><summary>AI 摘要</summary><div class="result summary-result">${escapeHtml(job.summary)}</div></details>`
      : '';
    return `
      <div class="result-label">音频原文${transcriptCountMeta(job.transcript, true)}</div>
      <div class="result transcript-result">${escapeHtml(job.transcript)}</div>
      ${summary}
    `;
  }
  return '<div class="meta">处理中...</div>';
}

function metricsHtml(metrics = {}) {
  const items = [
    ['播放', metrics.playCount],
    ['点赞', metrics.likeCount],
    ['评论', metrics.commentCount],
    ['收藏', metrics.collectCount],
    ['分享', metrics.shareCount],
  ].filter(([, value]) => value !== null && value !== undefined);
  if (!items.length) return '';
  return `
    <div class="metrics">
      ${items.map(([label, value]) => `<span>${label}: ${formatNumber(value)}</span>`).join('')}
    </div>
  `;
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(String(value));
  if (number >= 10000) {
    const digits = number >= 100000 ? 0 : 1;
    return `${(number / 10000).toFixed(digits)}万`;
  }
  return String(number);
}

function transcriptCountMeta(text, compact = false) {
  const count = countTranscriptChars(text);
  if (!count) return '';
  return compact ? ` · 原文字数 ${count}` : ` · 原文字数 ${count}`;
}

function countTranscriptChars(text) {
  return String(text || '')
    .replace(/\s+/g, '')
    .length;
}

function actionsHtml(job) {
  if (job.status !== 'done') return '';
  const links = [
    `<button class="secondary" data-copy="${job.id}" data-copy-kind="transcript">复制原文</button>`,
    job.summary ? `<button class="secondary" data-copy="${job.id}" data-copy-kind="summary">复制摘要</button>` : '',
    `<a href="/api/jobs/${job.id}/download/text"><button class="secondary">TXT</button></a>`,
    `<a href="/api/jobs/${job.id}/download/srt"><button class="secondary">SRT</button></a>`,
  ].filter(Boolean);
  return `<div class="job-actions">${links.join('')}</div>`;
}

async function copyJob(id) {
  const job = jobs.find((item) => item.id === id);
  if (!job) return;
  const button = document.querySelector(`[data-copy="${id}"]:focus`);
  const kind = button?.dataset.copyKind || 'transcript';
  await navigator.clipboard.writeText(kind === 'summary' ? (job.summary || '') : (job.transcript || ''));
}

function exportMarkdown() {
  const done = jobs.filter((job) => job.status === 'done');
  if (!done.length) return;
  const content = done.map((job) => [
    `## ${job.originalName || job.source || job.id}`,
    '',
    '### 音频原文',
    '',
    job.transcript || '',
    '',
    job.summary ? '### AI 摘要' : '',
    job.summary ? '' : '',
    job.summary || '',
    '',
  ].filter((line, index, lines) => line || lines[index - 1] !== '').join('\n')).join('\n');
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'videoscan-results.md';
  a.click();
  URL.revokeObjectURL(url);
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadJobs();
    if (!jobs.some((job) => ['queued', 'running'].includes(job.status))) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, 2500);
}

function labelStatus(status) {
  return {
    queued: '等待',
    running: '处理中',
    done: '完成',
    failed: '失败',
  }[status] || status;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const restMinutes = minutes % 60;
    return `${hours}小时${restMinutes}分${seconds}秒`;
  }
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
