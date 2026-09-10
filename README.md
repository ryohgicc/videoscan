# VideoScan

VideoScan 是一个本地运行的视频采集、转写和内容分析工具，适合把抖音、小红书等平台的视频整理成可检索的文字稿，再批量分析脚本结构、利益点和可复用表达。

## 功能概览

- `Agent 一键分析`：输入关键词、平台、筛选条件和总结目标，一次完成采集、筛选、转写和总结。
- `关键词→链接`：批量采集抖音/小红书候选视频，按平台、最低点赞量、发布时间和数量筛选，再确认进入转写。
- `链接→文稿`：批量粘贴视频链接或上传本地音视频，使用本地 Whisper、火山引擎或 OpenAI 兼容 ASR 转写。
- `文稿→总结`：选择历史转写记录，让 OpenAI 兼容模型生成结构化 Markdown 分析。
- 断点恢复：服务重启后，Agent 会从已保存的采集、筛选或转写阶段继续执行。
- 停止执行：可停止 Agent 的采集、排队任务和正在运行的下载/FFmpeg/Whisper 子进程；已完成的转写会保留，停止后不会进入总结。
- 实时状态：显示 Agent 当前阶段、执行时长、逐条转写成功/失败日志和失败原因。
- 历史与导出：保存采集、转写和分析历史，支持复制文字、复制链接、导出 TXT/SRT/Markdown/CSV。
- 浏览器扩展：在支持的平台视频页面上一键提交当前链接或扫描页面链接。

## 快速开始

### 1. 安装依赖

需要 Node.js 18+、FFmpeg，以及所选转写后端对应的依赖。

```bash
npm install
cp .env.example .env
```

### 2. 配置转写和总结

最简单的本地转写配置：

```dotenv
ASR_BACKEND=faster-whisper
FW_MODEL_SIZE=small
FW_DEVICE=auto
```

如果需要 `Agent 一键分析` 或 `文稿→总结`，还需要配置 OpenAI 兼容 API：

```dotenv
OPENAI_API_KEY=your_key
OPENAI_API_BASE=https://api.openai.com/v1
OPENAI_SUMMARY_MODEL=gpt-4o-mini
```

也可以在网页的“设置”中填写配置。保存后会写入 `.env`，并更新当前服务进程。

### 3. 启动

```bash
npm run dev
```

打开 [http://localhost:3333](http://localhost:3333)。

### 4. 检查

```bash
npm run check
node --check public/app.js
git diff --check
```

## Agent 工作流

Agent 按以下顺序执行：

```text
关键词采集
  → 平台 / 最低点赞量 / 近几天发布 / 最多分析视频数筛选
  → 只把筛选后的入选视频送入转写
  → 汇总已成功转写的文稿
  → 输出总结和用于分析的视频链接
```

页面会显示四个阶段：

1. 采集候选视频
2. 筛选候选视频
3. 转写入选视频
4. 生成总结

采集条数是每个关键词、每个平台的候选数量上限，默认 100，最大 500。筛选后的“最多分析视频数”决定进入转写的数量。某条转写失败不会阻塞其他视频；Agent 会把失败原因写入日志，并使用成功转写的结果继续总结。若全部失败，任务会失败。

点击“停止执行”后，任务状态会先变为“停止中”，随后变为“已停止”。重新启动服务时，未完成的 Agent 任务会自动恢复；已完成的转写不会重复处理。

## 文稿分析限制

普通 `文稿→总结` 当前默认限制为：

- 最多选择 10 条视频文稿。
- 每条文字稿最多发送 6000 字符，超出部分会截断。
- 因此正文输入通常最多约 60000 字符，另加标题、链接、指标和分析提示词。
- 单条长度配置允许在 `500` 到 `30000` 字符之间调整。

配置项：

```dotenv
HISTORY_ANALYSIS_MAX_ITEMS=10
HISTORY_ANALYSIS_MAX_CHARS=6000
```

当前实现同时限制视频条数和单条文字稿长度，尚未设置独立的总字符上限。建议保持较少的视频条数，并优先分析转写完整、与目标最相关的记录。

## 视频链接采集

默认使用本地开源工具解析链接，避免依赖付费解析 API：

```dotenv
VIDEO_INFO_PROVIDER=local-tools
DOUYIN_DOWNLOADER_DIR=/absolute/path/to/douyin-downloader
DOUYIN_PYTHON=/absolute/path/to/douyin-downloader/.venv/bin/python
XHS_DOWNLOADER_DIR=/absolute/path/to/XHS-Downloader
XHS_PYTHON=python3
XHS_COOKIE=your_xiaohongshu_web_cookie
```

安装抖音下载器：

```bash
git clone https://github.com/jiji262/douyin-downloader.git ../douyin-downloader
cd ../douyin-downloader
python3 -m pip install -r requirements.txt
cp config.example.yml config.yml
```

安装小红书下载器：

```bash
git clone https://github.com/JoeanAmier/XHS-Downloader.git ../XHS-Downloader
cd ../XHS-Downloader
python3 -m pip install -r requirements.txt
```

如果把 `XHS-Downloader/` 或 `MediaCrawler/` 放在项目根目录，它们会被本地运行使用，但这些目录属于外部依赖，不会提交到 Git。

需要时也可以使用解析 API：

```dotenv
VIDEO_INFO_PROVIDER=ai-douyin
AI_DOUYIN_API_KEY=your_key
```

或：

```dotenv
VIDEO_INFO_PROVIDER=tikhub
TIKHUB_TOKEN=your_token
```

抖音和小红书可能因登录校验、风控、Cookie 失效、内容删除或格式不支持而失败。页面日志会保留下载器和转写子进程输出；链接失败时，可以先下载视频，再通过“上传本地文件”转写。

## 转写后端

### faster-whisper

默认的本地方案：

```dotenv
ASR_BACKEND=faster-whisper
FW_PYTHON=python3
FW_MODEL_SIZE=small
FW_DEVICE=auto
```

### 火山引擎

```dotenv
ASR_BACKEND=volcengine
VOLCENGINE_API_KEY=your_key
VOLCENGINE_RESOURCE_ID=volc.seedasr.auc
VOLCENGINE_ASR_BASE=https://openspeech.bytedance.com/api/v3/auc/bigmodel
```

### OpenAI 兼容 ASR

```dotenv
ASR_BACKEND=openai
OPENAI_API_KEY=your_key
OPENAI_TRANSCRIBE_MODEL=whisper-1
```

## 数据和目录

运行数据默认保存在 `data/`，包括：

- `history.jsonl`：转写历史。
- `collector-history.jsonl`：采集历史。
- `analysis-history.jsonl`：分析历史。
- `agent-task.json`：当前 Agent 任务和断点。
- `collector/`：采集会话、日志和状态。

下载文件、音频、字幕和临时任务文件也会写入 `data/` 或 `uploads/`。这些目录已加入 `.gitignore`，不会提交到 Git。

## 浏览器扩展

扩展位于 `extension/`，使用 Chrome/Edge Manifest V3。

1. 启动 VideoScan。
2. 打开 Chrome 或 Edge 的扩展管理页面。
3. 开启开发者模式，选择“加载已解压的扩展程序”。
4. 选择本项目的 `extension/` 目录。
5. 在支持的视频页面点击浮动的 `VS` 按钮。

扩展支持提交当前视频链接，也支持扫描当前页面中的视频链接。完成后的任务会出现在 `链接→文稿` 历史中。

## 运行说明

- 默认最大并发任务数为 2，可通过 `MAX_CONCURRENT_JOBS` 调整，范围为 1 到 8。
- 采集器和转写任务会把实时日志写入页面。
- 复制按钮会显示“复制成功”或“复制失败，请检查浏览器权限”的 Toast。
- 修改 `.env` 后建议重启服务，确保所有配置都已重新加载。
