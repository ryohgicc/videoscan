# VideoScan Browser Extension PRD

## Background

VideoScan already provides a local web app that can accept Douyin/Xiaohongshu links, download media through local tools, extract audio with FFmpeg, transcribe with local `faster-whisper`, and save successful results into history. The browser extension should make the capture step faster: when the user is already viewing a supported video page, one click should submit the current video to the local VideoScan service.

## Goals

- Show a small floating action button on Douyin and Xiaohongshu pages.
- Detect the current video/note URL and normalize it before submitting.
- Submit the normalized URL to the local VideoScan backend.
- Show submission and job progress status in the floating panel.
- Reuse the existing backend download, audio extraction, transcription, metrics, deletion, and history logic.
- Ensure completed plugin jobs appear in the normal VideoScan history tab.

## Non-Goals

- The extension will not run FFmpeg or Whisper in the browser.
- The extension will not bypass platform login or anti-scraping controls.
- The extension will not scrape protected cookies or private account data.
- The extension will not implement a separate history database.

## User Flow

1. User starts the local VideoScan server.
2. User opens a Douyin or Xiaohongshu video page.
3. A floating `VS` button appears on the page.
4. User clicks the button.
5. The panel shows the detected canonical URL and a `下载并转文字` button.
6. User clicks the button.
7. Extension submits the URL to `http://localhost:3333/api/extension/capture`.
8. The panel polls `/api/jobs/:id` and shows progress.
9. When the job finishes, the user can open VideoScan history and see transcript, title, metrics, and outputs.

## URL Detection

The extension should prefer canonical video URLs:

- Douyin:
  - `https://www.douyin.com/video/{id}`
  - `modal_id` in search/profile pages
  - active anchor containing `/video/{id}` when available
- Xiaohongshu:
  - `https://www.xiaohongshu.com/explore/{id}`
  - `xsec_token` is preserved when present
  - active anchor containing `/explore/{id}` when available

If no canonical URL is found, it may submit the current page URL and let the backend decide.

## Backend API

Add:

```text
POST /api/extension/capture
```

Request:

```json
{
  "url": "https://www.douyin.com/video/7680147714327219462",
  "pageTitle": "current browser title",
  "pageUrl": "current full URL"
}
```

Response:

```json
{
  "ok": true,
  "job": {
    "id": "...",
    "status": "queued"
  }
}
```

## Success Criteria

- Plugin files pass JSON and JavaScript syntax checks.
- Backend syntax checks pass.
- A simulated extension capture request creates a VideoScan job.
- A real Douyin test URL can be captured, transcribed, and found in history.

## Limitations

- The local VideoScan server must be running.
- Platform risk controls may slow down or fail downloads.
- Direct current-page video byte capture is intentionally deferred; using platform page media URLs inside a browser extension is fragile and often still requires authenticated cookies. The first version submits canonical URLs to the existing local downloader pipeline.
