# 碎碎念 (Voice Diary) — Hackathon Submission

## Project Summary

**碎碎念** (Suì Suì Niàn — "murmuring thoughts") is an AI-powered voice diary Progressive Web App (PWA) that turns the effortless act of speaking into structured, beautiful memories — without the friction of typing.

Most people abandon journaling not because they lack thoughts, but because writing feels like work. Voice Diary removes that barrier: speak naturally, and Gemini handles the rest.

---

## Features & Functionality

### 1. 🎤 Instant Voice Transcription
Tap the microphone, speak freely, release — `gemini-2.0-flash` transcribes your audio inline (base64 WebM) and displays a timestamped diary entry in under 3 seconds.

### 2. 🤖 Niannian (念念) — Real-Time AI Voice Companion
A live voice AI friend powered by `gemini-2.5-flash-native-audio-latest` via the Gemini **Live API**:
- Listens and responds with natural, warm speech (no push-to-talk)
- Mirrors your emotional tone and volume (whisper → whisper back)
- Proactively asks follow-up questions to draw out meaningful reflection
- Automatically saves noteworthy moments as diary entries via **Function Calling** (`save_note` tool) — without you asking
- Can query your past entries (`get_past_entries`) and today's summary (`get_today_summary`) mid-conversation

### 3. ✦ Life-Coach Daily Summary
`gemini-2.0-flash` distills the day's entries into a structured summary with:
- A punchy, thematic title
- Emotional pattern recognition
- 2–3 concrete, actionable suggestions
- Reminders for unfinished items

### 4. 🎨 AI Watercolor Illustration
`gemini-2.5-flash-image` generates a unique, warm watercolor illustration for each day based on your diary content. Stored in IndexedDB and displayed in the Album and Calendar views.

### 5. 📅 Memory Review
- **Calendar view**: Month grid with illustration thumbnails; click any date to view all entries, summary, and illustration
- **Album view**: Flip-card gallery — front shows illustration, back reveals the full summary
- **Word export**: Download a formatted `.docx` of all diary entries and summaries
- **Auto-translation**: Summaries stored in one language are automatically translated when you switch to the other

---

## Technologies Used

### Google Cloud & Gemini
| Service | Usage |
|---------|-------|
| **Gemini 2.0 Flash** | Audio transcription (inline base64), daily summary generation, summary translation |
| **Gemini 2.5 Flash Native Audio Latest** | Real-time bidirectional voice conversation (Live API via WebSocket) |
| **Gemini 2.5 Flash Image** | Watercolor diary illustration generation |
| **Google Cloud Run** | Containerized Express.js server (Node.js 20, WebSocket long-timeout) |
| **Google Cloud Build** | Docker image build pipeline (`cloudbuild.yaml`) |
| **Artifact Registry** | Docker image storage (`asia-east1`) |

### Frontend
- Vanilla HTML/CSS/JavaScript — **no build step**, single `public/index.html`
- **AudioWorklet** — low-latency PCM 16kHz audio capture for Live API
- **MediaRecorder** — WebM audio capture for transcription
- **Web Audio API** — gapless PCM 24kHz playback with `nextPlayTime` scheduling
- **PWA** — installable on desktop and iOS/Android home screen

### Backend
- **Express.js** + **ws** (WebSocket) — REST API proxy + Live API relay
- **formidable** — multipart audio upload parsing
- **docx** — programmatic Word document generation
- **@google/genai** (v2) — Live API and image generation
- **@google/generative-ai** (v1) — stable REST API for transcription/summarize

### Client-Side Storage (no database required)
- **localStorage** — diary text entries, summaries, titles, translation cache, liked illustrations
- **IndexedDB** — raw audio Blobs, AI illustration data URLs

---

## Data Sources

All data is **user-generated**:
- Voice recordings captured in-browser (WebM via MediaRecorder)
- Diary text entries derived from those recordings via Gemini transcription
- AI-generated summaries and illustrations derived from those entries

No external datasets, third-party content, or external APIs beyond Gemini are used. All personal diary data stays in the user's browser (localStorage + IndexedDB) — the server is stateless.

---

## Findings & Learnings

### Gemini Live API
The most technically challenging part of this project. Key discoveries:
- **Session prewarming**: Cold-starting a Live API session takes 5–20 seconds, which would be unacceptable UX. We solved this by maintaining a "pool" of pre-warmed sessions on the server — one per language — so users connect instantly.
- **Bidirectional PCM streaming**: The Live API expects `audio/pcm;rate=16000` sent as base64 chunks every ~100ms, and returns `audio/pcm;rate=24000`. Buffering and scheduling these chunks with Web Audio API's `nextPlayTime` was critical for gap-free speech output.
- **Echo cancellation without hardware AEC**: Since we pipe audio through the browser (not native hardware), we had to implement a software solution: AudioWorklet monitors RMS amplitude and suppresses forwarding audio during playback, preventing the model's own voice from triggering a false barge-in.
- **VAD tuning**: `END_SENSITIVITY_LOW` with 1200ms silence threshold balanced natural conversation flow against premature turn-taking.
- **Function Calling in audio mode**: When the model wants to call `save_note`, it pauses audio output and emits a `toolCall` message — the server responds with `sendToolResponse`, after which normal conversation resumes seamlessly.

### Cloud Run for WebSocket
- Default Cloud Run request timeout is 5 minutes; long voice sessions require `--timeout 3600`
- `--min-instances 1` is essential — a cold start during an active voice session drops the WebSocket entirely

### PWA on iOS
- `webkit-playsinline` and `playsInline` flags are required for audio playback on iOS Safari
- `env(safe-area-inset-bottom)` padding prevents content from being hidden behind the iPhone home indicator

### Gemini Image Generation
- `gemini-2.5-flash-image` occasionally fails or returns empty results; implemented 3-attempt retry with exponential backoff

---

## Links

- **Live Demo:** https://voice-diary-947562481976.us-central1.run.app
- **GitHub:** https://github.com/SANABI-LL/Voice-Diary
- **GCP Proof (code):** [`server/index.js`](server/index.js) — see `ai.live.connect()` call; [`cloudbuild.yaml`](cloudbuild.yaml); [`server/Dockerfile`](server/Dockerfile)
