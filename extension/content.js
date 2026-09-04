(function initVideoScanCapture() {
  if (window.__videoscanCaptureMounted) return;
  window.__videoscanCaptureMounted = true;

  let currentJobId = '';
  let pollTimer = null;

  const root = document.createElement('div');
  root.id = 'videoscan-capture-root';
  root.innerHTML = `
    <button class="videoscan-fab" type="button" title="VideoScan">VS</button>
    <section class="videoscan-panel" hidden>
      <div class="videoscan-head">
        <strong>VideoScan</strong>
        <button class="videoscan-close" type="button" aria-label="Close">x</button>
      </div>
      <div class="videoscan-url"></div>
      <button class="videoscan-submit" type="button">下载并转文字</button>
      <button class="videoscan-open" type="button">打开历史记录</button>
      <div class="videoscan-status">准备就绪</div>
    </section>
  `;
  document.documentElement.appendChild(root);

  const panel = root.querySelector('.videoscan-panel');
  const fab = root.querySelector('.videoscan-fab');
  const close = root.querySelector('.videoscan-close');
  const submit = root.querySelector('.videoscan-submit');
  const open = root.querySelector('.videoscan-open');
  const urlEl = root.querySelector('.videoscan-url');
  const statusEl = root.querySelector('.videoscan-status');

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    refreshDetectedUrl();
  });
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  submit.addEventListener('click', submitCapture);
  open.addEventListener('click', () => {
    window.open('http://localhost:3333/#history', '_blank', 'noopener,noreferrer');
  });

  refreshDetectedUrl();
  window.addEventListener('popstate', refreshDetectedUrl);
  window.setInterval(refreshDetectedUrl, 2000);

  function refreshDetectedUrl() {
    const detected = detectVideoUrl();
    urlEl.textContent = detected || '没有识别到视频链接';
    submit.disabled = !detected;
  }

  async function submitCapture() {
    const url = detectVideoUrl();
    if (!url) {
      setStatus('没有识别到当前视频链接');
      return;
    }
    submit.disabled = true;
    setStatus('提交到本地 VideoScan...');
    const response = await chrome.runtime.sendMessage({
      type: 'videoscan:capture',
      payload: {
        url,
        pageUrl: location.href,
        pageTitle: document.title,
      },
    });
    if (!response?.ok) {
      submit.disabled = false;
      setStatus(`提交失败：${response?.error || '未知错误'}`);
      return;
    }
    currentJobId = response.job.id;
    setStatus(`已提交：${currentJobId}`);
    startPolling();
  }

  function startPolling() {
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = window.setInterval(pollJob, 2500);
    pollJob();
  }

  async function pollJob() {
    if (!currentJobId) return;
    const response = await chrome.runtime.sendMessage({ type: 'videoscan:getJob', jobId: currentJobId });
    if (!response?.ok) {
      setStatus(`查询失败：${response?.error || '未知错误'}`);
      return;
    }
    const job = response.job;
    setStatus(`${labelStatus(job.status)} · ${job.progress || ''}`);
    if (job.status === 'done' || job.status === 'failed') {
      window.clearInterval(pollTimer);
      pollTimer = null;
      submit.disabled = false;
      if (job.status === 'failed') setStatus(`失败：${job.error || '未知错误'}`);
      else setStatus(`完成：${job.title || job.originalName || job.source}`);
    }
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }
})();

function detectVideoUrl() {
  const fromPage = normalizeSupportedUrl(location.href);
  if (fromPage && isCanonicalSupportedUrl(fromPage)) return fromPage;

  const selectors = [
    'a[href*="/video/"]',
    'a[href*="/explore/"]',
    'a[href*="modal_id="]',
    'link[rel="canonical"]',
  ];
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const raw = node.href || node.getAttribute('href');
      const normalized = normalizeSupportedUrl(raw);
      if (normalized && isCanonicalSupportedUrl(normalized)) return normalized;
    }
  }

  return fromPage || '';
}

function normalizeSupportedUrl(rawValue) {
  if (!rawValue) return '';
  let parsed;
  try {
    parsed = new URL(rawValue, location.href);
  } catch {
    return '';
  }

  const host = parsed.hostname;
  const full = parsed.href;
  if (/douyin\.com|iesdouyin\.com|tiktok\.com/i.test(host)) {
    const modalId = parsed.searchParams.get('modal_id');
    const videoMatch = parsed.pathname.match(/\/video\/(\d{8,})/);
    const noteMatch = full.match(/(?:modal_id=|\/video\/)(\d{8,})/);
    const id = modalId || videoMatch?.[1] || noteMatch?.[1];
    if (id) return `https://www.douyin.com/video/${id}`;
    return parsed.href;
  }

  if (/xiaohongshu\.com|xhslink\.(com|cn)|rednote\.com/i.test(host)) {
    const match = parsed.pathname.match(/\/explore\/([A-Za-z0-9]+)/);
    if (!match) return parsed.href;
    const clean = new URL(`https://www.xiaohongshu.com/explore/${match[1]}`);
    const xsecToken = parsed.searchParams.get('xsec_token');
    if (xsecToken) clean.searchParams.set('xsec_token', xsecToken);
    return clean.href;
  }

  return '';
}

function isCanonicalSupportedUrl(value) {
  return /douyin\.com\/video\/\d{8,}/i.test(value)
    || /xiaohongshu\.com\/explore\/[A-Za-z0-9]+/i.test(value);
}

function labelStatus(status) {
  return {
    queued: '等待',
    running: '处理中',
    done: '完成',
    failed: '失败',
  }[status] || status;
}
