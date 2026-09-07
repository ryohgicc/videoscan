# Changelog

## 2026-09-07

- Added keyword filtering to the `链接→文稿` history table and kept selection actions scoped to the filtered rows.
- Split history storage and UI into per-workflow tables for collector, transcription, and analysis flows.
- Added a collector tab for keyword-based Douyin/Xiaohongshu discovery with preview-first selection.
- Unified collector settings with existing downloader config and added local XHS downloader auto-detection.
- Wired XHS downloader support into the local download chain and saved XHS cookies in `.env`.
- Verified end-to-end Douyin transcription and summary flow with local retries.

## 2026-09-04

- Added browser extension support for TikTok and Instagram pages.
- Added a page link scanner in the extension to collect and copy supported video links.
- Added a Volcengine ASR punctuation setting and persisted it through `.env`.
