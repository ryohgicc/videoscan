const DEFAULT_SERVER = 'http://localhost:3333';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;
  if (message.type === 'videoscan:capture') {
    captureCurrentVideo(message.payload).then(sendResponse);
    return true;
  }
  if (message.type === 'videoscan:getJob') {
    getJob(message.jobId).then(sendResponse);
    return true;
  }
  return false;
});

async function captureCurrentVideo(payload) {
  try {
    const server = await getServerBase();
    const response = await fetch(`${server}/api/extension/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return { ok: true, job: body.job };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getJob(jobId) {
  try {
    const server = await getServerBase();
    const response = await fetch(`${server}/api/jobs/${encodeURIComponent(jobId)}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return { ok: true, job: body.job };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function getServerBase() {
  const stored = await chrome.storage.local.get({ serverBase: DEFAULT_SERVER });
  return String(stored.serverBase || DEFAULT_SERVER).replace(/\/$/, '');
}
