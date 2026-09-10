const jobsEl = document.querySelector('#jobs');
const historyEl = document.querySelector('#history');
const configStatusEl = document.querySelector('#configStatus');
const linksEl = document.querySelector('#links');
const filesEl = document.querySelector('#files');
const configMessageEl = document.querySelector('#configMessage');
const settingsDialog = document.querySelector('#settingsDialog');
const asrBackendEl = document.querySelector('#asrBackend');
const jobStatsEl = document.querySelector('#jobStats');
const analysisPurposeEl = document.querySelector('#analysisPurpose');
const analysisMessageEl = document.querySelector('#analysisMessage');
const analysisResultEl = document.querySelector('#analysisResult');
const analysisHistoryEl = document.querySelector('#analysisHistory');
const analysisHistoryCountEl = document.querySelector('#analysisHistoryCount');
const analysisTaskStatusEl = document.querySelector('#analysisTaskStatus');
const analysisTaskProgressEl = document.querySelector('#analysisTaskProgress');
const analysisTaskPurposeEl = document.querySelector('#analysisTaskPurpose');
const analysisTaskSourcesEl = document.querySelector('#analysisTaskSources');
const analysisTaskLogsEl = document.querySelector('#analysisTaskLogs');
const jobsPanelEl = document.querySelector('#jobsPanel');
const toggleJobsPanelEl = document.querySelector('#toggleJobsPanel');
const agentKeywordsEl = document.querySelector('#agentKeywords');
const agentPlatformsEl = document.querySelector('#agentPlatforms');
const agentLimitEl = document.querySelector('#agentLimit');
const agentMinLikeEl = document.querySelector('#agentMinLike');
const agentRecentDaysEl = document.querySelector('#agentRecentDays');
const agentMaxVisibleEl = document.querySelector('#agentMaxVisible');
const agentRetriesEl = document.querySelector('#agentRetries');
const agentPurposeEl = document.querySelector('#agentPurpose');
const agentMessageEl = document.querySelector('#agentMessage');
const agentTaskStatusEl = document.querySelector('#agentTaskStatus');
const agentTaskStageEl = document.querySelector('#agentTaskStage');
const agentTaskDurationEl = document.querySelector('#agentTaskDuration');
const agentTaskProgressEl = document.querySelector('#agentTaskProgress');
const agentTaskLogsEl = document.querySelector('#agentTaskLogs');
const agentResultMetaEl = document.querySelector('#agentResultMeta');
const agentResultEl = document.querySelector('#agentResult');
const agentLinksEl = document.querySelector('#agentLinks');
const toastEl = document.querySelector('#toast');
const collectorKeywordsEl = document.querySelector('#collectorKeywords');
const collectorPlatformsEl = document.querySelector('#collectorPlatforms');
const collectorLimitEl = document.querySelector('#collectorLimit');
const collectorRetriesEl = document.querySelector('#collectorRetries');
const collectorMinLikeEl = document.querySelector('#collectorMinLike');
const collectorRecentDaysEl = document.querySelector('#collectorRecentDays');
const collectorMaxVisibleEl = document.querySelector('#collectorMaxVisible');
const collectorPlatformFilterEl = document.querySelector('#collectorPlatformFilter');
const collectorStatusEl = document.querySelector('#collectorStatus');
const collectorTableEl = document.querySelector('#collectorTable');
const collectorStatsEl = document.querySelector('#collectorStats');
const collectorProgressFillEl = document.querySelector('#collectorProgressFill');
const collectorProgressTextEl = document.querySelector('#collectorProgressText');
const collectorProgressDetailEl = document.querySelector('#collectorProgressDetail');
const collectorLogsEl = document.querySelector('#collectorLogs');
const collectorLogStatsEl = document.querySelector('#collectorLogStats');
const collectorHistoryEl = document.querySelector('#collectorHistory');
const collectorHistoryCountEl = document.querySelector('#collectorHistoryCount');
const historyKeywordFilterEl = document.querySelector('#historyKeywordFilter');
let currentConfig = {};

document.querySelector('#submitLinks').addEventListener('click', submitLinks);
document.querySelector('#submitFiles').addEventListener('click', submitFiles);
document.querySelector('#refresh').addEventListener('click', loadJobs);
document.querySelector('#exportMarkdown').addEventListener('click', exportMarkdown);
document.querySelector('#toggleJobsPanel').addEventListener('click', toggleJobsPanel);
document.querySelector('#selectAllHistory').addEventListener('click', selectAllHistory);
document.querySelector('#clearHistorySelection').addEventListener('click', clearHistorySelection);
document.querySelector('#clearHistoryFilter').addEventListener('click', clearHistoryFilter);
document.querySelector('#analyzeHistory').addEventListener('click', analyzeSelectedHistory);
document.querySelector('#copyAnalysis').addEventListener('click', copyAnalysis);
document.querySelector('#openSettings').addEventListener('click', openSettings);
document.querySelector('#saveConfig').addEventListener('click', saveConfig);
document.querySelector('#testSummaryLlm').addEventListener('click', testSummaryLlm);
document.querySelector('#testAsrApi').addEventListener('click', testAsrApi);
document.querySelector('#startCollector').addEventListener('click', startCollector);
document.querySelector('#refreshCollector').addEventListener('click', loadCollectorSession);
document.querySelector('#refreshCollectorLog').addEventListener('click', loadCollectorSession);
document.querySelector('#selectAllCollector').addEventListener('click', selectAllCollector);
document.querySelector('#clearCollectorSelection').addEventListener('click', clearCollectorSelection);
document.querySelector('#submitSelectedCollector').addEventListener('click', submitSelectedCollector);
document.querySelector('#exportCollector').addEventListener('click', exportCollectorResults);
document.querySelector('#startAgent').addEventListener('click', startAgent);
document.querySelector('#stopAgent').addEventListener('click', stopAgent);
document.querySelector('#copyAgentResult').addEventListener('click', copyAgentResult);
document.querySelector('#copyAgentLinks').addEventListener('click', copyAgentLinks);
collectorMinLikeEl.addEventListener('input', renderCollectorTable);
collectorRecentDaysEl.addEventListener('input', renderCollectorTable);
collectorMaxVisibleEl.addEventListener('input', renderCollectorTable);
collectorPlatformFilterEl.addEventListener('change', renderCollectorTable);

let jobs = [];
let historyItems = [];
let historyKeywordFilter = '';
let analysisHistoryItems = [];
let analysisTask = null;
let collectorHistoryItems = [];
let selectedHistoryIds = new Set();
let historySort = { key: 'playCount', direction: 'desc' };
let collectorSort = { key: 'playCount', direction: 'desc' };
let lastAnalysisText = '';
let lastAnalysisId = '';
let pollTimer = null;
let collectorSessionId = '';
let collectorItems = [];
let selectedCollectorIds = new Set();
let collectorPollTimer = null;
let agentTask = null;

await loadConfig();
await loadJobs();
await loadHistory();
await loadAnalysisHistory();
await loadAnalysisTask();
await loadAgentTask();
await loadCollectorSession();
await loadCollectorHistory();
switchTab(location.hash.replace('#', '') || 'current');
startPolling();
updateJobsPanelToggleText();
startAnalysisPolling();
startAgentPolling();

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
}

window.addEventListener('hashchange', () => switchTab(location.hash.replace('#', '') || 'current'));
asrBackendEl.addEventListener('change', updateAsrModeVisibility);
historyKeywordFilterEl.addEventListener('input', () => {
  historyKeywordFilter = historyKeywordFilterEl.value.trim();
  renderHistory();
});

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
  document.querySelector('#volcengineEnablePunc').checked = config.volcengineEnablePunc !== false;
  document.querySelector('#xhsDownloaderDir').value = config.xhsDownloaderDir || '';
  document.querySelector('#xhsPython').value = config.xhsPython || 'python3';
  document.querySelector('#xhsCookie').value = '';
  document.querySelector('#xhsCookie').placeholder = config.xhsCookie ? '********' : '可选';
  document.querySelector('#enableSummary').checked = Boolean(config.enableSummary);
  document.querySelector('#deleteVideoAfterTranscribe').checked = Boolean(config.deleteVideoAfterTranscribe);
  updateAsrModeVisibility();
}

function loadCollectorDefaults() {
  collectorKeywordsEl.value = collectorKeywordsEl.value || '';
  collectorLimitEl.value = collectorLimitEl.value || '100';
  collectorRetriesEl.value = collectorRetriesEl.value || '2';
}

function fillCollectorControls(session = {}) {
  collectorKeywordsEl.value = (session.keywords || []).join('\n');
  collectorLimitEl.value = session.limitPerKeyword || 100;
  collectorRetriesEl.value = session.retries ?? 2;
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
    volcengineEnablePunc: document.querySelector('#volcengineEnablePunc').checked,
    xhsDownloaderDir: document.querySelector('#xhsDownloaderDir').value,
    xhsPython: document.querySelector('#xhsPython').value,
  };
  const openaiApiKey = document.querySelector('#openaiApiKey').value.trim();
  if (openaiApiKey) payload.openaiApiKey = openaiApiKey;
  const volcengineApiKey = document.querySelector('#volcengineApiKey').value.trim();
  if (volcengineApiKey) payload.volcengineApiKey = volcengineApiKey;
  const xhsCookie = document.querySelector('#xhsCookie').value.trim();
  if (xhsCookie) payload.xhsCookie = xhsCookie;
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
  document.querySelector('#xhsCookie').value = '';
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
  for (const input of ['#volcengineApiKey', '#volcengineResourceId', '#volcengineAsrBase', '#volcengineEnablePunc']) {
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
  await loadHistory();
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
  await loadHistory();
  startPolling();
}

async function loadCollectorSession() {
  const response = await fetch('/api/collector/session');
  const payload = await response.json().catch(() => ({}));
  const session = payload.session || {};
  collectorSessionId = session.id || '';
  collectorItems = session.items || [];
  selectedCollectorIds = new Set(collectorItems.filter((item) => item.selected !== false).map((item) => item.id));
  renderCollectorTable();
  fillCollectorControls(session);
  renderCollectorProgress(session);
  renderCollectorLogs(session);
  if (session.status === 'running') startCollectorPolling();
  else stopCollectorPolling();
}

async function startCollector() {
  const keywords = collectorKeywordsEl.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const platforms = [...collectorPlatformsEl.selectedOptions].map((option) => option.value);
  if (!keywords.length) {
    collectorStatusEl.textContent = '请先输入关键词。';
    return;
  }
  if (!platforms.length) {
    collectorStatusEl.textContent = '请至少选择一个平台。';
    return;
  }
  collectorStatusEl.textContent = '正在本地采集...';
  const response = await fetch('/api/collector/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      platforms,
      limitPerKeyword: Number(collectorLimitEl.value || 20),
      retries: Number(collectorRetriesEl.value || 0),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    collectorStatusEl.textContent = `采集失败：${payload.error || '未知错误'}`;
    return;
  }
  collectorSessionId = payload.session?.id || collectorSessionId;
  collectorStatusEl.textContent = '采集已开始，正在后台运行...';
  startCollectorPolling();
  await loadCollectorSession();
  await loadCollectorHistory();
}

async function startAgent() {
  const keywords = agentKeywordsEl.value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const platforms = [...agentPlatformsEl.selectedOptions].map((option) => option.value);
  const purpose = agentPurposeEl.value.trim();
  if (!keywords.length) {
    agentMessageEl.textContent = '请先输入关键词。';
    return;
  }
  if (!platforms.length) {
    agentMessageEl.textContent = '请至少选择一个平台。';
    return;
  }
  if (!purpose) {
    agentMessageEl.textContent = '请填写总结目标。';
    return;
  }
  const button = document.querySelector('#startAgent');
  button.disabled = true;
  agentMessageEl.textContent = '正在创建 Agent 任务...';
  const response = await fetch('/api/agent/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords,
      platforms,
      purpose,
      limitPerKeyword: Number(agentLimitEl.value || 100),
      minLike: agentMinLikeEl.value,
      recentDays: agentRecentDaysEl.value,
      maxVisible: agentMaxVisibleEl.value,
      retries: Number(agentRetriesEl.value || 0),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  button.disabled = false;
  if (!response.ok || !payload.ok) {
    agentMessageEl.textContent = `启动失败：${payload.error || '未知错误'}`;
    return;
  }
  agentTask = payload.task;
  renderAgentTask();
  agentMessageEl.textContent = '任务已开始，Agent 会按顺序完成三个步骤。';
  switchTab('agent');
  startAgentPolling();
}

async function loadAgentTask() {
  const response = await fetch('/api/agent/task');
  const payload = await response.json().catch(() => ({}));
  agentTask = payload.task || null;
  renderAgentTask();
}

function renderAgentTask() {
  const task = agentTask || {};
  const status = {
    idle: '等待',
    queued: '排队中',
    running: '执行中',
    stopping: '停止中',
    done: '完成',
    failed: '失败',
  }[task.status] || task.status || '等待';
  const stageLabels = {
    idle: '等待开始',
    collecting: '1/4 采集候选视频',
    filtering: '2/4 筛选候选视频',
    transcribing: '3/4 转写入选视频',
    summarizing: '4/4 生成总结',
    completed: '已完成',
    stopped: '已停止',
    failed: '执行失败',
  };
  agentTaskStatusEl.textContent = status;
  agentTaskStageEl.textContent = stageLabels[task.stage] || task.stage || '等待开始';
  agentTaskDurationEl.textContent = `执行时长 ${formatAgentDuration(task)}`;
  agentTaskProgressEl.textContent = task.progress || '等待开始';
  agentTaskLogsEl.textContent = task.logs?.length ? task.logs.join('\n') : '还没有日志。';
  const links = task.sourceLinks || [];
  agentLinksEl.value = links.join('\n');
  agentResultEl.innerHTML = task.analysis ? renderMarkdown(task.analysis) : '还没有结果。';
  agentResultMetaEl.textContent = task.status === 'done'
    ? `采集 ${task.candidateCount || 0} 条 · 入选 ${task.selectedItems?.length || 0} 条 · 转写 ${task.sourceHistory?.length || 0} 条`
    : task.error || '完成后显示总结和入选链接';
  agentMessageEl.textContent = task.status === 'failed' ? `任务失败：${task.error || '未知错误'}` : agentMessageEl.textContent;
  const active = ['queued', 'running'].includes(task.status);
  document.querySelector('#startAgent').disabled = active || task.status === 'stopping';
  document.querySelector('#stopAgent').disabled = !active;
  startAgentDurationTicker();
}

function formatAgentDuration(task = {}) {
  if (!task.startedAt) return '0秒';
  const end = task.finishedAt || Date.now();
  const totalSeconds = Math.max(0, Math.floor((end - task.startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

function startAgentDurationTicker() {
  if (window.agentDurationTimer) clearInterval(window.agentDurationTimer);
  if (!agentTask || !['queued', 'running'].includes(agentTask.status)) {
    window.agentDurationTimer = null;
    return;
  }
  window.agentDurationTimer = setInterval(() => {
    if (agentTaskDurationEl) {
      agentTaskDurationEl.textContent = `执行时长 ${formatAgentDuration(agentTask)}`;
    }
  }, 1000);
}

function startAgentPolling() {
  if (window.agentPollTimer) clearInterval(window.agentPollTimer);
  window.agentPollTimer = setInterval(async () => {
    await loadAgentTask();
    if (!agentTask || ['idle', 'done', 'failed', 'stopped'].includes(agentTask.status)) {
      clearInterval(window.agentPollTimer);
      window.agentPollTimer = null;
      document.querySelector('#startAgent').disabled = false;
    }
  }, 2000);
}

async function copyAgentResult() {
  if (!agentTask?.analysis) return;
  await copyTextWithToast(agentTask.analysis);
}

async function copyAgentLinks() {
  if (!agentTask?.sourceLinks?.length) return;
  await copyTextWithToast(agentTask.sourceLinks.join('\n'));
}

let toastTimer = null;

function showToast(message, type = 'success') {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast visible ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 1800);
}

async function copyTextWithToast(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('复制成功');
  } catch (error) {
    showToast('复制失败，请检查浏览器权限', 'error');
    return false;
  }
}

async function stopAgent() {
  const button = document.querySelector('#stopAgent');
  button.disabled = true;
  agentMessageEl.textContent = '正在停止 Agent 任务...';
  const response = await fetch('/api/agent/stop', { method: 'POST' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    button.disabled = false;
    agentMessageEl.textContent = `停止失败：${payload.error || '未知错误'}`;
    return;
  }
  agentTask = payload.task || agentTask;
  renderAgentTask();
  startAgentPolling();
}

function renderCollectorTable() {
  const total = collectorItems.length;
  const selected = selectedCollectorIds.size;
  const filteredItems = getFilteredCollectorItems();
  const visibleSelected = filteredItems.filter((item) => selectedCollectorIds.has(item.id)).length;
  collectorStatsEl.textContent = total
    ? `已采集 ${total} 条 · 筛选后 ${filteredItems.length} 条 · 已选 ${visibleSelected} 条`
    : '还没有结果。';
  if (!total) {
    collectorTableEl.innerHTML = '<tr><td colspan="12" class="meta">还没有采集结果。</td></tr>';
    return;
  }
  const items = sortMetricItems(filteredItems, collectorSort);
  if (!items.length) {
    collectorTableEl.innerHTML = '<tr><td colspan="12" class="meta">没有符合当前筛选条件的结果。</td></tr>';
    return;
  }
  collectorTableEl.innerHTML = items.map((item) => `
    <tr>
      <td><input type="checkbox" data-collector-select="${escapeAttribute(item.id)}" ${selectedCollectorIds.has(item.id) ? 'checked' : ''}></td>
      <td>${escapeHtml(item.platformLabel || item.platform || '')}</td>
      <td>
        <div class="table-title">${escapeHtml(item.title || '')}</div>
        <div class="table-subtitle">${escapeHtml(item.status || '')}</div>
      </td>
      <td>${escapeHtml(item.author || '')}</td>
      <td>${escapeHtml(String(metricValue(item.metrics, 'playCount') ?? 0))}</td>
      <td>${escapeHtml(String(metricValue(item.metrics, 'likeCount') ?? 0))}</td>
      <td>${escapeHtml(String(metricValue(item.metrics, 'commentCount') ?? 0))}</td>
      <td>${escapeHtml(String(metricValue(item.metrics, 'collectCount') ?? 0))}</td>
      <td>${escapeHtml(String(metricValue(item.metrics, 'shareCount') ?? 0))}</td>
      <td>${escapeHtml(formatPublishedAt(item.publishedAt))}</td>
      <td>${escapeHtml((item.keywords || []).join(' / '))}</td>
      <td><a href="${escapeAttribute(item.url || '#')}" target="_blank" rel="noreferrer">打开</a></td>
    </tr>
  `).join('');
  for (const input of document.querySelectorAll('[data-collector-select]')) {
    input.addEventListener('change', () => {
      if (input.checked) selectedCollectorIds.add(input.dataset.collectorSelect);
      else selectedCollectorIds.delete(input.dataset.collectorSelect);
      renderCollectorTable();
      persistCollectorSelection();
    });
  }
}

function getFilteredCollectorItems() {
  const platform = collectorPlatformFilterEl?.value || '';
  const minLike = positiveNumberOrNull(collectorMinLikeEl?.value);
  const recentDays = positiveNumberOrNull(collectorRecentDaysEl?.value);
  const maxVisible = positiveNumberOrNull(collectorMaxVisibleEl?.value);
  const cutoff = recentDays ? Date.now() - recentDays * 24 * 60 * 60 * 1000 : null;
  const filtered = collectorItems.filter((item) => {
    if (platform && item.platform !== platform) return false;
    const likeCount = metricValue(item.metrics, 'likeCount');
    if (minLike !== null && (likeCount === null || likeCount < minLike)) return false;
    if (cutoff !== null && (!item.publishedAt || item.publishedAt < cutoff)) return false;
    return true;
  });
  return maxVisible ? sortMetricItems(filtered, collectorSort).slice(0, maxVisible) : filtered;
}

function positiveNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function formatPublishedAt(value) {
  if (!value) return '未知';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '未知' : date.toLocaleDateString('zh-CN');
}

function renderCollectorProgress(session = {}) {
  const progress = session.progress || {};
  const done = Number(progress.done || 0);
  const total = Number(progress.total || 0);
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  if (collectorProgressFillEl) {
    collectorProgressFillEl.style.width = `${Math.round(ratio * 100)}%`;
  }
  if (collectorProgressTextEl) {
    collectorProgressTextEl.textContent = session.status === 'running'
      ? `正在采集：${progress.label || '处理中'}`
      : session.status === 'done'
        ? '采集完成'
        : session.status === 'failed'
          ? '采集失败'
          : '等待采集';
  }
  if (collectorProgressDetailEl) {
    collectorProgressDetailEl.textContent = `${done} / ${total}`;
  }
  if (session.status === 'running') {
    collectorStatusEl.textContent = `正在采集：${progress.label || '处理中'}，已完成 ${done}/${total}`;
  } else if (session.status === 'done') {
    collectorStatusEl.textContent = `采集完成，共 ${collectorItems.length} 条。请二次确认后再转写。`;
  } else if (session.status === 'failed') {
    collectorStatusEl.textContent = `采集失败：${session.error || '未知错误'}`;
  }
}

function renderCollectorLogs(session = {}) {
  const logs = session.logs || [];
  if (collectorLogStatsEl) {
    collectorLogStatsEl.textContent = logs.length ? `最新 ${logs.length} 条` : '还没有日志。';
  }
  if (collectorLogsEl) {
    collectorLogsEl.textContent = logs.length ? logs.join('\n') : '还没有日志。';
  }
}

function startCollectorPolling() {
  if (collectorPollTimer) return;
  collectorPollTimer = setInterval(async () => {
    const response = await fetch('/api/collector/session');
    const payload = await response.json().catch(() => ({}));
    const session = payload.session || {};
    collectorSessionId = session.id || collectorSessionId;
    collectorItems = session.items || collectorItems;
    selectedCollectorIds = new Set(collectorItems.filter((item) => item.selected !== false).map((item) => item.id));
    renderCollectorTable();
    renderCollectorProgress(session);
    renderCollectorLogs(session);
    fillCollectorControls(session);
    if (session.status !== 'running') {
      stopCollectorPolling();
    }
  }, 2000);
}

function stopCollectorPolling() {
  if (!collectorPollTimer) return;
  clearInterval(collectorPollTimer);
  collectorPollTimer = null;
}

function formatCollectorMetrics(metrics = {}) {
  const parts = [
    ['播', metrics.playCount],
    ['赞', metrics.likeCount],
    ['评', metrics.commentCount],
    ['藏', metrics.collectCount],
    ['转', metrics.shareCount],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return parts.map(([label, value]) => `${label}${formatNumber(value)}`).join(' ');
}

function selectAllCollector() {
  selectedCollectorIds = new Set(getFilteredCollectorItems().map((item) => item.id));
  renderCollectorTable();
  persistCollectorSelection();
}

function clearCollectorSelection() {
  selectedCollectorIds = new Set();
  renderCollectorTable();
  persistCollectorSelection();
}

async function submitSelectedCollector() {
  const visibleIds = new Set(getFilteredCollectorItems().map((item) => item.id));
  const selectedVisibleIds = [...selectedCollectorIds].filter((id) => visibleIds.has(id));
  const items = collectorItems.filter((item) => selectedVisibleIds.includes(item.id));
  if (!items.length) {
    collectorStatusEl.textContent = '请先在当前筛选结果中选择要转写的视频。';
    return;
  }
  const links = items.map((item) => item.url).filter(Boolean);
  collectorStatusEl.textContent = '正在送入转写队列...';
  const response = await fetch('/api/collector/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: collectorSessionId, ids: selectedVisibleIds }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    collectorStatusEl.textContent = `提交失败：${payload.error || '未知错误'}`;
    return;
  }
  collectorStatusEl.textContent = `已送入转写队列 ${links.length} 条。`;
  await loadJobs();
  startPolling();
}

async function persistCollectorSelection() {
  if (!collectorSessionId) return;
  await fetch('/api/collector/selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: collectorSessionId, ids: [...selectedCollectorIds] }),
  }).catch(() => {});
}

function exportCollectorResults() {
  if (!collectorItems.length) return;
  const header = ['platform', 'title', 'author', 'playCount', 'likeCount', 'commentCount', 'collectCount', 'shareCount', 'keywords', 'url'];
  const rows = [header.join(',')];
  for (const item of collectorItems) {
    const metrics = item.metrics || {};
    rows.push([
      csvCell(item.platform || ''),
      csvCell(item.title || ''),
      csvCell(item.author || ''),
      csvCell(metrics.playCount),
      csvCell(metrics.likeCount),
      csvCell(metrics.commentCount),
      csvCell(metrics.collectCount),
      csvCell(metrics.shareCount),
      csvCell((item.keywords || []).join(' / ')),
      csvCell(item.url || ''),
    ].join(','));
  }
  const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'collector-results.csv';
  a.click();
  URL.revokeObjectURL(url);
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
  const countEl = document.querySelector('#currentHistoryCount');
  if (countEl) countEl.textContent = historyItems.length ? `共 ${historyItems.length} 条` : '还没有历史记录。';
  renderHistory();
}

function getFilteredHistoryItems() {
  const filter = historyKeywordFilter.trim().toLowerCase();
  if (!filter) return historyItems;
  return historyItems.filter((item) => {
    const keywords = [
      ...(item.sourceKeywords || []),
      item.keyword || '',
      item.title || '',
      item.source || '',
    ].map((value) => String(value || '').toLowerCase());
    return keywords.some((value) => value.includes(filter));
  });
}

async function loadCollectorHistory() {
  const response = await fetch('/api/collector/history');
  const payload = await response.json();
  collectorHistoryItems = payload.history || [];
  if (collectorHistoryCountEl) {
    collectorHistoryCountEl.textContent = collectorHistoryItems.length ? `共 ${collectorHistoryItems.length} 条` : '还没有采集历史。';
  }
  renderCollectorHistory();
}

async function loadAnalysisHistory() {
  const response = await fetch('/api/history/analysis');
  const payload = await response.json();
  analysisHistoryItems = payload.analyses || [];
  if (analysisHistoryCountEl) {
    analysisHistoryCountEl.textContent = analysisHistoryItems.length ? `共 ${analysisHistoryItems.length} 条` : '还没有分析记录。';
  }
  renderAnalysisHistory();
}

async function loadAnalysisTask() {
  const response = await fetch('/api/history/analysis/task');
  const payload = await response.json().catch(() => ({}));
  analysisTask = payload.task || null;
  renderAnalysisTask();
}

function renderJobs() {
  updateJobStats();
  if (!jobs.length) {
    jobsEl.innerHTML = '<p class="meta compact-empty">没有进行中的任务。</p>';
    updateJobsPanelState(false);
    return;
  }
  updateJobsPanelState(jobs.some((job) => ['queued', 'running', 'failed'].includes(job.status)));

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

function toggleJobsPanel() {
  if (!jobsPanelEl) return;
  jobsPanelEl.open = !jobsPanelEl.open;
  updateJobsPanelToggleText();
}

function updateJobsPanelState(shouldOpen) {
  if (!jobsPanelEl) return;
  if (shouldOpen) jobsPanelEl.open = true;
  updateJobsPanelToggleText();
}

function updateJobsPanelToggleText() {
  if (!toggleJobsPanelEl || !jobsPanelEl) return;
  toggleJobsPanelEl.textContent = jobsPanelEl.open ? '收起' : '展开';
}

function updateJobStats() {
  const total = jobs.length;
  const done = jobs.filter((job) => job.status === 'done').length;
  const failed = jobs.filter((job) => job.status === 'failed').length;
  const active = jobs.filter((job) => ['queued', 'running'].includes(job.status)).length;
  const parts = [`已完成 ${done}/${total}`];
  if (active) parts.push(`进行中 ${active}`);
  if (failed) parts.push(`失败 ${failed}`);
  if (jobStatsEl) jobStatsEl.textContent = parts.join(' · ');
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
  const visibleItems = getFilteredHistoryItems();
  if (!historyItems.length) {
    historyEl.innerHTML = '<p class="meta">还没有历史记录。</p>';
    updateHistoryCount(0, 0);
    updateAnalysisMessage();
    return;
  }
  if (!visibleItems.length) {
    historyEl.innerHTML = '<p class="meta">没有匹配的历史记录。</p>';
    updateHistoryCount(0, historyItems.length);
    updateAnalysisMessage();
    return;
  }

  const items = sortMetricItems(visibleItems, historySort);
  historyEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>选中</th>
          <th>标题</th>
          <th>来源</th>
          <th>关键词</th>
          <th><button class="table-sort" data-history-sort="playCount">播放</button></th>
          <th><button class="table-sort" data-history-sort="likeCount">点赞</button></th>
          <th><button class="table-sort" data-history-sort="commentCount">评论</button></th>
          <th><button class="table-sort" data-history-sort="collectCount">收藏</button></th>
          <th><button class="table-sort" data-history-sort="shareCount">转发</button></th>
          <th>时长</th>
          <th>文字稿</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item) => `
          <tr>
            <td>
              <input type="checkbox" data-history-select="${escapeAttribute(item.jobId)}" ${selectedHistoryIds.has(item.jobId) ? 'checked' : ''}>
            </td>
            <td>
              <div class="table-title">${escapeHtml(item.title || item.source || item.jobId)}</div>
            </td>
            <td>
              <div class="table-subtitle">${escapeHtml(item.source || '')}</div>
            </td>
            <td>
              <div class="table-subtitle">${escapeHtml((item.sourceKeywords || []).join(' / ') || item.keyword || '无')}</div>
            </td>
            <td>${escapeHtml(String(metricValue(item.metrics, 'playCount') ?? 0))}</td>
            <td>${escapeHtml(String(metricValue(item.metrics, 'likeCount') ?? 0))}</td>
            <td>${escapeHtml(String(metricValue(item.metrics, 'commentCount') ?? 0))}</td>
            <td>${escapeHtml(String(metricValue(item.metrics, 'collectCount') ?? 0))}</td>
            <td>${escapeHtml(String(metricValue(item.metrics, 'shareCount') ?? 0))}</td>
            <td>${escapeHtml(formatDuration(item.durationMs || 0))}</td>
            <td>
              <div class="table-subtitle">${escapeHtml(truncateText(item.transcript || '', 120) || '无文字稿')}</div>
            </td>
            <td>
              <div class="job-actions">
                <button class="secondary" data-history-copy="${escapeAttribute(item.jobId)}">复制</button>
                <button class="secondary danger" data-history-delete="${escapeAttribute(item.jobId)}">删除</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

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
  for (const button of document.querySelectorAll('[data-history-sort]')) {
    button.addEventListener('click', () => toggleHistorySort(button.dataset.historySort));
  }
  for (const button of document.querySelectorAll('[data-collector-sort]')) {
    button.addEventListener('click', () => toggleCollectorSort(button.dataset.collectorSort));
  }
  updateAnalysisMessage();
  updateHistoryCount(visibleItems.length, historyItems.length);
}

function toggleHistorySort(key) {
  historySort = nextSortState(historySort, key);
  renderHistory();
}

function toggleCollectorSort(key) {
  collectorSort = nextSortState(collectorSort, key);
  renderCollectorTable();
}

function formatHistoryMetrics(metrics = {}) {
  const parts = [
    ['播', metrics.playCount],
    ['赞', metrics.likeCount],
    ['评', metrics.commentCount],
    ['藏', metrics.collectCount],
    ['转', metrics.shareCount],
  ].filter(([, value]) => value !== null && value !== undefined && value !== '');
  return parts.map(([label, value]) => `${label}${formatNumber(value)}`).join(' ');
}

function sortMetricItems(items, sortState) {
  const direction = sortState?.direction === 'asc' ? 1 : -1;
  const key = sortState?.key || 'playCount';
  return [...items].sort((a, b) => {
    const av = metricValue(a.metrics, key);
    const bv = metricValue(b.metrics, key);
    const diff = Number(av ?? -Infinity) - Number(bv ?? -Infinity);
    if (diff !== 0) return diff * direction;
    return String(a.title || a.jobId || a.id || '').localeCompare(String(b.title || b.jobId || b.id || ''), 'zh-CN');
  });
}

function metricValue(metrics = {}, key) {
  const value = metrics?.[key];
  return value === null || value === undefined || value === '' ? null : Number(value);
}

function nextSortState(current, key) {
  if (current?.key === key) {
    return { key, direction: current.direction === 'desc' ? 'asc' : 'desc' };
  }
  return { key, direction: 'desc' };
}

function truncateText(text, maxChars) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > maxChars ? `${value.slice(0, maxChars)}...` : value;
}

async function copyHistory(jobId) {
  const item = historyItems.find((entry) => entry.jobId === jobId);
  if (!item) return;
  await copyTextWithToast(item.transcript || '');
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

async function deleteAnalysisHistory(analysisId) {
  const item = analysisHistoryItems.find((entry) => entry.analysisId === analysisId);
  if (!item) return;
  const title = item.purpose || analysisId;
  if (!window.confirm(`删除这条分析记录？\n${title}`)) return;
  const response = await fetch(`/api/history/analysis/${encodeURIComponent(analysisId)}`, { method: 'DELETE' });
  if (!response.ok) {
    updateAnalysisMessage('删除失败。');
    return;
  }
  if (lastAnalysisId === analysisId) {
    lastAnalysisId = '';
    lastAnalysisText = '';
    analysisResultEl.textContent = '还没有分析结果。';
  }
  await loadAnalysisHistory();
  updateAnalysisMessage('已删除分析记录。');
}

function selectAllHistory() {
  const max = Number(document.querySelector('#historyAnalysisMaxItems').value || 10);
  selectedHistoryIds = new Set(getFilteredHistoryItems().slice(0, max).map((item) => item.jobId));
  renderHistory();
}

function clearHistorySelection() {
  selectedHistoryIds = new Set();
  renderHistory();
}

function clearHistoryFilter() {
  historyKeywordFilter = '';
  if (historyKeywordFilterEl) historyKeywordFilterEl.value = '';
  renderHistory();
}

function updateHistoryCount(visibleCount, totalCount) {
  const countEl = document.querySelector('#currentHistoryCount');
  if (!countEl) return;
  if (!totalCount) {
    countEl.textContent = '还没有历史记录。';
    return;
  }
  countEl.textContent = visibleCount === totalCount
    ? `共 ${totalCount} 条`
    : `共 ${visibleCount}/${totalCount} 条`;
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
  updateAnalysisMessage('正在创建分析任务...');
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
  await loadAnalysisTask();
  renderAnalysisTask();
  updateAnalysisMessage(`分析任务已创建，共 ${payload.task?.usedItems || jobIds.length} 条。`);
  switchTab('analysis');
  startAnalysisPolling();
}

async function copyAnalysis() {
  if (!lastAnalysisText) return;
  await copyTextWithToast(lastAnalysisText);
}

function renderAnalysisHistory() {
  if (!analysisHistoryEl) return;
  if (!analysisHistoryItems.length) {
    analysisHistoryEl.innerHTML = '<p class="meta">还没有分析记录。</p>';
    return;
  }
  analysisHistoryEl.innerHTML = analysisHistoryItems.map((item) => {
    const sourceTitles = (item.sourceHistory || [])
      .map((record) => escapeHtml(record.title || record.originalName || record.jobId))
      .join('、');
    return `
      <article class="analysis-item">
        <div class="analysis-item-head">
          <div>
            <div class="source">${escapeHtml(item.purpose || '未命名分析')}</div>
            <div class="meta">${escapeHtml(formatAnalysisMeta(item))}</div>
          </div>
          <div class="analysis-item-actions">
            <button class="secondary" data-analysis-load="${escapeAttribute(item.analysisId)}">查看</button>
            <button class="secondary danger" data-analysis-delete="${escapeAttribute(item.analysisId)}">删除</button>
          </div>
        </div>
        <div class="meta analysis-sources">${sourceTitles || '无来源'}</div>
        <div class="analysis-snippet">${escapeHtml(truncateText(item.analysis || '', 180) || '无分析结果')}</div>
      </article>
    `;
  }).join('');

  for (const button of document.querySelectorAll('[data-analysis-load]')) {
    button.addEventListener('click', () => loadAnalysisResult(button.dataset.analysisLoad));
  }
  for (const button of document.querySelectorAll('[data-analysis-delete]')) {
    button.addEventListener('click', () => deleteAnalysisHistory(button.dataset.analysisDelete));
  }
}

function renderAnalysisTask() {
  const task = analysisTask || {};
  if (analysisTaskStatusEl) {
    analysisTaskStatusEl.textContent = labelAnalysisStatus(task.status || 'idle');
  }
  if (analysisTaskProgressEl) {
    analysisTaskProgressEl.textContent = task.progress || '等待分析';
  }
  if (analysisTaskPurposeEl) {
    analysisTaskPurposeEl.textContent = task.purpose || '未命名分析';
  }
  if (analysisTaskSourcesEl) {
    analysisTaskSourcesEl.textContent = (task.sourceHistory || [])
      .map((record) => record.title || record.originalName || record.jobId)
      .join('、') || '无来源';
  }
  if (analysisTaskLogsEl) {
    const logs = task.logs || [];
    analysisTaskLogsEl.textContent = logs.length ? logs.join('\n') : '还没有日志。';
  }
  if (task.analysis) {
    analysisResultEl.innerHTML = renderMarkdown(task.analysis);
  } else {
    analysisResultEl.textContent = '还没有分析结果。';
  }
}

function labelAnalysisStatus(status) {
  return {
    idle: '等待',
    queued: '排队中',
    running: '分析中',
    done: '完成',
    failed: '失败',
  }[status] || status;
}

function startAnalysisPolling() {
  if (window.analysisPollTimer) clearInterval(window.analysisPollTimer);
  window.analysisPollTimer = setInterval(async () => {
    await loadAnalysisTask();
    if (!analysisTask || ['idle', 'done', 'failed'].includes(analysisTask.status)) {
      clearInterval(window.analysisPollTimer);
      window.analysisPollTimer = null;
      await loadAnalysisHistory();
    }
  }, 2000);
}

function renderCollectorHistory() {
  if (!collectorHistoryEl) return;
  if (!collectorHistoryItems.length) {
    collectorHistoryEl.innerHTML = '<p class="meta">还没有采集历史。</p>';
    return;
  }
  collectorHistoryEl.innerHTML = collectorHistoryItems.map((item) => `
    <article class="job">
      <div class="job-head">
        <div>
          <div class="source">${escapeHtml((item.keywords || []).join(' / ') || item.sessionId)}</div>
          <div class="meta">${escapeHtml((item.platforms || []).join('、'))} · ${escapeHtml(item.status || '')} · ${formatDateTime(item.finishedAt || item.savedAt || item.createdAt)}</div>
        </div>
        <span class="badge done">采集</span>
      </div>
      <div class="meta">结果 ${escapeHtml(String(item.itemCount || 0))} 条</div>
      <div class="job-actions">
        <button class="secondary" data-collector-history-load="${escapeAttribute(item.sessionId)}">查看</button>
        <button class="secondary danger" data-collector-history-delete="${escapeAttribute(item.sessionId)}">删除</button>
      </div>
    </article>
  `).join('');

  for (const button of document.querySelectorAll('[data-collector-history-load]')) {
    button.addEventListener('click', () => loadCollectorHistoryEntry(button.dataset.collectorHistoryLoad));
  }
  for (const button of document.querySelectorAll('[data-collector-history-delete]')) {
    button.addEventListener('click', () => deleteCollectorHistory(button.dataset.collectorHistoryDelete));
  }
}

async function loadCollectorHistoryEntry(sessionId) {
  const response = await fetch(`/api/collector/session/${encodeURIComponent(sessionId)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.session) return;
  collectorSessionId = payload.session.id || '';
  collectorItems = payload.session.items || [];
  selectedCollectorIds = new Set(collectorItems.filter((item) => item.selected !== false).map((item) => item.id));
  fillCollectorControls(payload.session);
  renderCollectorTable();
  renderCollectorProgress(payload.session);
  renderCollectorLogs(payload.session);
  switchTab('collector');
}

async function deleteCollectorHistory(sessionId) {
  if (!window.confirm('删除这条采集历史？')) return;
  const response = await fetch(`/api/collector/history/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  if (!response.ok) return;
  await loadCollectorHistory();
}

function formatAnalysisMeta(item) {
  const count = item.usedItems || (item.sourceHistory || []).length || 0;
  const when = formatDateTime(item.createdAt || item.savedAt || Date.now());
  return `${count} 条 · ${when}`;
}

function formatDateTime(value) {
  const date = new Date(Number(value || Date.now()));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function loadAnalysisResult(analysisId) {
  const item = analysisHistoryItems.find((entry) => entry.analysisId === analysisId);
  if (!item) return;
  lastAnalysisId = item.analysisId || '';
  lastAnalysisText = item.analysis || '';
  analysisResultEl.innerHTML = lastAnalysisText ? renderMarkdown(lastAnalysisText) : 'AI 没有返回内容。';
  switchTab('analysis');
}

function switchTab(name) {
  if (!['agent', 'current', 'collector', 'analysis'].includes(name)) name = 'collector';
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  document.querySelector('#currentView').classList.toggle('active', name === 'current');
  document.querySelector('#collectorView').classList.toggle('active', name === 'collector');
  document.querySelector('#analysisView').classList.toggle('active', name === 'analysis');
  document.querySelector('#agentView').classList.toggle('active', name === 'agent');
  if (name === 'collector') loadCollectorSession();
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
  await copyTextWithToast(kind === 'summary' ? (job.summary || '') : (job.transcript || ''));
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
    await loadHistory();
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

function renderMarkdown(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const blocks = [];
  const fencePattern = /```([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = fencePattern.exec(text))) {
    if (match.index > lastIndex) {
      blocks.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    blocks.push({ type: 'code', value: match[1].replace(/^\n/, '') });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    blocks.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return blocks.map((block) => {
    if (block.type === 'code') {
      return `<pre><code>${escapeHtml(block.value).replace(/\n$/, '')}</code></pre>`;
    }
    return renderMarkdownTextBlock(block.value);
  }).join('');
}

function renderMarkdownTextBlock(source) {
  const lines = String(source || '').split('\n');
  const parts = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      parts.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ''));
        index += 1;
      }
      parts.push(`<blockquote>${renderMarkdownParagraphs(quoteLines.join('\n'))}</blockquote>`);
      continue;
    }

    if (/^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(line)) {
      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
      const ordered = Boolean(listMatch && /\d+\./.test(listMatch[2]));
      const items = [];
      while (index < lines.length) {
        const current = lines[index].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!current) break;
        items.push(current[3]);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      parts.push(`<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const table = readMarkdownTable(lines, index);
    if (table) {
      parts.push(table.html);
      index = table.nextIndex;
      continue;
    }

    const paragraph = [];
    while (index < lines.length && lines[index].trim()) {
      if (index !== 0 && /^(#{1,6})\s+/.test(lines[index])) break;
      if (/^>\s?/.test(lines[index])) break;
      if (/^(\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[index])) break;
      if (/^```/.test(lines[index])) break;
      paragraph.push(lines[index]);
      index += 1;
    }
    parts.push(`<p>${renderInlineMarkdown(paragraph.join(' '))}</p>`);
  }

  return parts.join('');
}

function renderMarkdownParagraphs(source) {
  return String(source || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${renderInlineMarkdown(line)}</p>`)
    .join('');
}

function readMarkdownTable(lines, startIndex) {
  if (startIndex + 1 >= lines.length) return null;
  const header = lines[startIndex];
  const separator = lines[startIndex + 1];
  if (!header.includes('|') || !/^\s*\|?[\s:-]+(\|[\s:-]+)+\|?\s*$/.test(separator)) return null;
  const rows = [header, separator];
  let nextIndex = startIndex + 2;
  while (nextIndex < lines.length && lines[nextIndex].includes('|') && lines[nextIndex].trim()) {
    rows.push(lines[nextIndex]);
    nextIndex += 1;
  }
  const splitRow = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const headCells = splitRow(rows[0]);
  const bodyRows = rows.slice(2).map(splitRow);
  const html = [
    '<table><thead><tr>',
    ...headCells.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`),
    '</tr></thead><tbody>',
    ...bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join('')}</tr>`),
    '</tbody></table>',
  ].join('');
  return { html, nextIndex };
}

function renderInlineMarkdown(source) {
  let text = escapeHtml(String(source || ''));
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/(?:^|\s)\[([^\]]+)\]\(([^)]+)\)/g, (match, label, href) => {
    const safeHref = escapeAttribute(href).replace(/"/g, '&quot;');
    return `${match.startsWith(' ') ? ' ' : ''}<a href="${safeHref}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  text = text.replace(/\n/g, '<br>');
  return text;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[,"\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
