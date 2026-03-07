# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Always respond in English unless explicitly asked otherwise.

# Voice Diary (碎碎念)

语音日记 PWA — 录制语音、Gemini AI 自动转录、生成每日总结，支持实时语音对话 Agent（念念）。

## Project Stack

This project uses JavaScript/TypeScript with HTML. When editing files, prefer TypeScript where .ts files already exist. For JavaScript files, maintain consistent ES module syntax.

Primary languages: HTML, TypeScript, JavaScript. When creating or editing files, prefer TypeScript for logic and use proper typing.

## Bug Fixing Protocol

When fixing bugs: 1) Read the relevant code and reproduce the issue first 2) Make the fix 3) Verify the fix works by running the app or relevant test 4) If the fix doesn't work on first attempt, re-read the actual output before trying again.

## Verification

Always verify changes actually work before reporting success. For UI changes, check the browser output. For API changes, make a test call. Never assume a fix works — confirm it.

## Debugging

When debugging issues, always verify the fix works by running the relevant code or checking output before reporting success. If a fix doesn't work on first attempt, investigate root cause more deeply rather than applying surface-level patches.

## 命令

**本地开发（必须用 Node.js 20 LTS，Node 24 在 Windows 上会崩溃）：**
- `npm install` — 安装根目录依赖（api/ 使用）
- `cd server && npm install` — 安装 server 依赖
- `cd server && node --env-file=../.env index.js` — 启动本地开发服务器（端口 8080）
- `cd server && node --env-file=../.env --watch index.js` — 带热重载启动（等同 `npm run dev`）
- 访问 `http://localhost:8080`（不要用 vercel dev，WebSocket 不支持）

**环境变量**（根目录 `.env` 文件）：
```
GEMINI_API_KEY=AIza...
```

**部署到 Google Cloud Run：**
- `gcloud builds submit --config cloudbuild.yaml .` — 构建并推送镜像
- `gcloud run deploy voice-diary --image asia-east1-docker.pkg.dev/voice-diary-solst-2025/voice-diary/app:latest --platform managed --region us-central1 --allow-unauthenticated --port 8080 --memory 512Mi --cpu 1 --min-instances 1 --timeout 3600 --set-env-vars GEMINI_API_KEY=...`
- 线上 URL：`https://voice-diary-947562481976.us-central1.run.app`

**GitHub 仓库：**
- 地址：`https://github.com/SANABI-LL/Voice-Diary`
- 工作流：本地改代码 → 测试 → `git add . && git commit -m "..." && git push`
- `.gitignore` 已排除：`.env`、`node_modules/`、`*.tmp.*`、`.claude/`

## 架构

**单文件前端**：`public/index.html` 包含所有 CSS、HTML、JS（无构建步骤）。

**双存储系统**：
- `localStorage`（key: `vd_entries`）— 存储条目的文字内容和元数据（JSON 数组）
- `localStorage`（key: `vd_summaries`）— 存储每日 AI 总结，格式 `{ dateStr: summaryText }`
- `IndexedDB`（db: `voice-diary-audio` v2，store: `audio`）— 存储原始音频 Blob，以条目 id 为 key
- `IndexedDB`（db: `voice-diary-audio` v2，store: `illus`）— 存储 AI 插图 data URL，key = dateStr；v2 迁移时新增此 store

**数据流（普通录音）**：
1. 前端用 `MediaRecorder` 录制 WebM 音频
2. 录音结束 → POST `multipart/form-data` 到 `/api/transcribe`（字段名 `audio`）
3. `transcribe.js` 用 `formidable` 解析，MIME type 去掉 codec 参数，以 inline base64 发送给 Gemini
4. 转录文字 + 时间戳存入 `vd_entries`，音频 Blob 存入 IndexedDB

**数据流（念念实时对话）**：
1. 前端建立 WebSocket 连接到 `/live`，发送 `{ type: 'start', context: { recentEntries, todaySummary } }`
2. `server/index.js` 用上下文构建 systemInstruction，连接 Gemini Live API
3. 前端用 AudioWorklet 捕获 PCM 16kHz，以 base64 通过 WebSocket 发送
4. Gemini 返回音频（PCM 24kHz）+ 转录文字，前端播放并显示字幕
5. Gemini 可触发 Function Call（save_note / get_past_entries / get_today_summary）

**API 函数**（`api/` 目录，兼容 Vercel Serverless 和 Express 路由）：
- `transcribe.js`：`formidable` 处理 multipart，`gemini-2.0-flash` inline base64 转录；使用旧版 SDK `@google/generative-ai`（`GoogleGenerativeAI`）
- `summarize.js`：生活教练风格总结，手动解析 JSON body stream；支持 `lang` 参数（zh/en）
- `illustrate.js`：`gemini-2.5-flash-image` 生成插图，使用新版 SDK `@google/genai`（`GoogleGenAI`）
- `translate.js`：总结翻译（中↔英），`gemini-2.0-flash`；前端缓存至 `localStorage vd_translations`
- `export.js`：用 `docx` 库导出 Word 文档

> **注意**：项目中同时安装了两个 Gemini SDK：`@google/generative-ai`（旧，`transcribe.js` 用）和 `@google/genai`（新，`illustrate.js` 和 `server/index.js` 用）。新增功能请统一用新版 `@google/genai`。

**server/**（Node.js + Express + WebSocket，用于本地开发和 Cloud Run）：
- `server/index.js`：主服务器，代理所有 `/api/*` 路由 + WebSocket `/live` 端点
- `server/package.json`：依赖（`@google/genai`, `express`, `ws`, `formidable`, `docx` 等）
- `server/Dockerfile`：Cloud Run 容器配置（node_modules 必须装在 `/app/` 顶层）
- `cloudbuild.yaml`：Cloud Build 配置（指定 Dockerfile 路径）

**PWA**：有 `manifest.json`、`icon.png`、apple-mobile-web-app 元标签，支持安装到桌面/主屏幕。

**视图**：三个 tab —「今日」（录音 + 条目列表 + 生成总结 + 生成插图 + 念念对话）、「相册」（插图翻转卡片，点击展开查看完整总结，支持自动翻译）、「日历」（按月浏览历史 + 插图缩略图 + 导出 Word）。

## 规范

- 所有 UI 文字和 AI prompt 用**简体中文**
- 主题：深色为主（`--bg: #13100e`，金色 `--warm: #e8a857`），支持浅色/深色/自动三模式，通过 `data-theme` attribute 切换
- Serverless 函数用 `export default` handler 模式（ESM）
- Gemini 模型：文字/总结用 `gemini-2.0-flash`，插图用 `gemini-2.5-flash-image`，实时对话用 `gemini-2.5-flash-native-audio-latest`
- API key 从 `process.env.GEMINI_API_KEY` 读取
- 日期格式：`YYYY-MM-DD`，时间格式：`HH:MM`，locale：`zh-CN`
- WebSocket URL 自动适配：本地 `ws://`，生产（HTTPS）`wss://`
- dateStr 存储格式不统一（zh-CN 返回 `2026/03/07`，en-CA 返回 `2026-03-07`），读取时统一用 `.replace(/\//g, '-')` 规范化再解析
