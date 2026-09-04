(function initVideoScanCapture() {
  if (window.__videoscanCaptureMounted) return;
  window.__videoscanCaptureMounted = true;

  let currentJobId = '';
  let pollTimer = null;
  let currentLinks = [];

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
      <div class="videoscan-actions">
        <button class="videoscan-submit" type="button">下载并转文字</button>
        <button class="videoscan-scan" type="button">获取本页所有视频链接</button>
      </div>
      <div class="videoscan-results" hidden>
        <div class="videoscan-results-head">
          <strong>本页链接</strong>
          <button class="videoscan-copy" type="button">复制全部</button>
        </div>
        <div class="videoscan-list"></div>
      </div>
      <button class="videoscan-open" type="button">打开历史记录</button>
      <div class="videoscan-status">准备就绪</div>
    </section>
  `;
  document.documentElement.appendChild(root);

  const panel = root.querySelector('.videoscan-panel');
  const fab = root.querySelector('.videoscan-fab');
  const close = root.querySelector('.videoscan-close');
  const submit = root.querySelector('.videoscan-submit');
  const scan = root.querySelector('.videoscan-scan');
  const copy = root.querySelector('.videoscan-copy');
  const open = root.querySelector('.videoscan-open');
  const urlEl = root.querySelector('.videoscan-url');
  const statusEl = root.querySelector('.videoscan-status');
  const resultsEl = root.querySelector('.videoscan-results');
  const listEl = root.querySelector('.videoscan-list');

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    refreshDetectedUrl();
    refreshCollectedLinks();
  });
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  submit.addEventListener('click', submitCapture);
  scan.addEventListener('click', collectPageLinks);
  copy.addEventListener('click', copyCollectedLinks);
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

  function refreshCollectedLinks() {
    resultsEl.hidden = currentLinks.length === 0;
    listEl.innerHTML = '';
    for (const link of currentLinks) {
      const row = document.createElement('div');
      row.className = 'videoscan-link-row';
      const text = document.createElement('div');
      text.className = 'videoscan-link-text';
      text.textContent = link;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'videoscan-copy-one';
      button.textContent = '复制';
      button.addEventListener('click', () => copyText(link));
      row.append(text, button);
      listEl.appendChild(row);
    }
  }

  async function collectPageLinks() {
    const links = collectVideoLinksFromPage();
    currentLinks = links;
    refreshCollectedLinks();
    setStatus(links.length ? `已找到 ${links.length} 个视频链接` : '没有找到可识别的视频链接');
    if (links.length) await copyText(links.join('\n'));
  }

  async function copyCollectedLinks() {
    if (!currentLinks.length) {
      setStatus('没有可复制的链接');
      return;
    }
    await copyText(currentLinks.join('\n'));
    setStatus(`已复制 ${currentLinks.length} 个链接`);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    }
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

function collectVideoLinksFromPage() {
  const found = new Set();
  const candidates = [
    location.href,
    ...collectCandidateUrlsFromDom(),
  ];
  for (const raw of candidates) {
    const normalized = normalizeSupportedUrl(raw);
    if (normalized && isSupportedVideoContentUrl(normalized)) found.add(normalized);
  }
  return [...found];
}

function collectCandidateUrlsFromDom() {
  const selectors = [
    'a[href]',
    'link[rel="canonical"]',
    'meta[property="og:url"]',
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="al:ios:url"]',
    'meta[property="al:android:url"]',
  ];
  const values = [];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      const raw = node.href || node.getAttribute('content') || node.getAttribute('href');
      if (raw) values.push(raw);
    });
  }
  const scripts = document.querySelectorAll('script');
  for (const script of scripts) {
    const text = script.textContent || '';
    if (!text) continue;
    const matches = text.matchAll(/https?:\/\/[^\s"'<>\\]+/g);
    for (const match of matches) values.push(match[0]);
  }
  return values;
}

function detectVideoUrl() {
  const links = collectVideoLinksFromPage();
  return links[0] || '';
}

function normalizeSupportedUrl(rawValue) {
  if (!rawValue) return '';
  let parsed;
  try {
    parsed = new URL(rawValue, location.href);
  } catch {
    return '';
  }

  const host = parsed.hostname.replace(/^m\./i, '');
  const full = parsed.href;

  if (/^(www\.)?(douyin\.com|iesdouyin\.com)$/i.test(host) || /tiktok\.com$/i.test(host)) {
    const id = extractShortVideoId(parsed);
    if (!id) return '';
    if (/tiktok\.com$/i.test(host)) {
      const userVideoMatch = parsed.pathname.match(/\/(@[^/]+)\/video\/\d{8,}/);
      if (userVideoMatch) return `https://www.tiktok.com/${userVideoMatch[1]}/video/${id}`;
      return `https://www.tiktok.com/video/${id}`;
    }
    if (id) return `https://www.douyin.com/video/${id}`;
  }

  if (/^(www\.)?(xiaohongshu\.com|rednote\.com|xhslink\.com|xhslink\.cn)$/i.test(host)) {
    const match = parsed.pathname.match(/\/explore\/([A-Za-z0-9]+)/) || full.match(/\/discovery\/item\/([A-Za-z0-9]+)/);
    if (!match) return '';
    const clean = new URL(`https://www.xiaohongshu.com/explore/${match[1]}`);
    const xsecToken = parsed.searchParams.get('xsec_token');
    if (xsecToken) clean.searchParams.set('xsec_token', xsecToken);
    return clean.href;
  }

  if (/^(www\.)?instagram\.com$/i.test(host)) {
    const match = parsed.pathname.match(/\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (!match) return '';
    return `https://www.instagram.com/${match[1]}/${match[2]}/`;
  }

  return '';
}

function extractShortVideoId(url) {
  const idFromPath = url.pathname.match(/\/video\/(\d{8,})/);
  return url.searchParams.get('modal_id') || url.searchParams.get('aweme_id') || idFromPath?.[1] || '';
}

function isSupportedVideoContentUrl(value) {
  return /^https:\/\/www\.douyin\.com\/video\/\d{8,}$/i.test(value)
    || /^https:\/\/www\.tiktok\.com\/(?:@[^/]+\/)?video\/\d{8,}$/i.test(value)
    || /^https:\/\/www\.xiaohongshu\.com\/explore\/[A-Za-z0-9]+(?:\?xsec_token=[^#]+)?$/i.test(value)
    || /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/$/i.test(value);
}

function labelStatus(status) {
  return {
    queued: '等待',
    running: '处理中',
    done: '完成',
    failed: '失败',
  }[status] || status;
}
