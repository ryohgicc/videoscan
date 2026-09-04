# VideoScan

VideoScan is a small local web app for batch video/audio transcription. It accepts Douyin/Xiaohongshu links when a resolver API is configured, and it also accepts direct local audio/video uploads.

## Features

- Batch paste video links.
- Batch upload local audio/video files.
- Extract audio with FFmpeg.
- Transcribe locally through `faster-whisper` by default.
- Optional OpenAI-compatible transcription backend remains in the server code for later use.
- Optional OpenAI summary output.
- Optional local open-source downloaders for Douyin/Xiaohongshu.
- Show video metrics from downloader metadata when available.
- Analyze selected history records with an OpenAI-compatible LLM.
- Browser extension capture button for Douyin/Xiaohongshu pages.
- Export text, SRT, and Markdown.
- Optionally delete downloaded video files after transcription to save disk space.
- Limit concurrent jobs from the settings dialog.
- Configure history analysis item and transcript length limits from the settings dialog.

## Requirements

- Node.js 18+
- FFmpeg
- OpenAI-compatible API key for optional summaries
- Local `faster-whisper` dependencies for transcription
- Volcengine ASR credentials if you want the API mode
- Local Douyin/Xiaohongshu downloader repos, or AI Douyin/TikHub for link parsing

## Setup

```bash
npm install
cp .env.example .env
```

Then edit `.env`.

You can fill these from the web page, or edit `.env` directly. For the most stable first run, set:

```bash
ASR_BACKEND=faster-whisper
OPENAI_API_KEY=your_key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_SUMMARY_MODEL=gpt-4o-mini
```

To use the API speech mode, switch `ASR_BACKEND=volcengine` and fill:

```bash
VOLCENGINE_API_KEY=...
VOLCENGINE_RESOURCE_ID=volc.seedasr.auc
VOLCENGINE_ASR_BASE=https://openspeech.bytedance.com/api/v3/auc/bigmodel
```

## Free Local Link Parsing

The default `VIDEO_INFO_PROVIDER=local-tools` mode calls local open-source downloaders instead of paid resolver APIs.

Clone and install the Douyin downloader:

```bash
git clone https://github.com/jiji262/douyin-downloader.git ../douyin-downloader
cd ../douyin-downloader
python3 -m pip install -r requirements.txt
cp config.example.yml config.yml
```

For better Douyin stability, run its cookie helper if needed:

```bash
python3 -m tools.cookie_fetcher --config config.yml
```

Clone and install the Xiaohongshu downloader:

```bash
git clone https://github.com/JoeanAmier/XHS-Downloader.git ../XHS-Downloader
cd ../XHS-Downloader
python3.12 -m pip install -r requirements.txt
```

Then set:

```bash
VIDEO_INFO_PROVIDER=local-tools
DOUYIN_DOWNLOADER_DIR=/absolute/path/to/douyin-downloader
DOUYIN_PYTHON=/absolute/path/to/douyin-downloader/.venv/bin/python
DOUYIN_PROXY=http://10.0.10.123:8888
XHS_DOWNLOADER_DIR=/absolute/path/to/XHS-Downloader
XHS_PYTHON=python3.12
```

Xiaohongshu may need a web cookie for stable/high-quality downloads:

```bash
XHS_COOKIE=your_xiaohongshu_web_cookie
```

## Paid Resolver Fallback

If you prefer resolver APIs instead of local tools, set one of:

```bash
AI_DOUYIN_API_KEY=your_key
```

or:

```bash
VIDEO_INFO_PROVIDER=tikhub
TIKHUB_TOKEN=your_token
```

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:3333
```

The page has a settings dialog. Saving there writes the known keys back to `.env` and updates the running server process.

## Browser Extension

The extension lives in `extension/` and uses Chrome/Edge Manifest V3.

1. Start VideoScan:

```bash
npm run dev
```

2. Open Chrome or Edge extension management.
3. Enable developer mode.
4. Load unpacked extension and select this folder:

```text
/Users/apple/Documents/videoscan/extension
```

5. Open a Douyin or Xiaohongshu video page.
6. Click the floating `VS` button, then click `下载并转文字`.

The extension submits the normalized current video URL to the local backend. Completed jobs appear in the normal history tab.

## Notes

Douyin and Xiaohongshu links may still fail because of login checks, platform risk control, deleted content, or unsupported note formats. Upload the saved video/audio file when link parsing fails.
