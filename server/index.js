import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { GoogleGenAI, Modality } from "@google/genai";
import { fileURLToPath } from "url";
import path from "path";

// 动态导入现有 API 处理器
import transcribeHandler from "../api/transcribe.js";
import summarizeHandler from "../api/summarize.js";
import illustrateHandler from "../api/illustrate.js";
import exportHandler from "../api/export.js";
import translateHandler from "../api/translate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// 静态文件
app.use(express.static(path.join(__dirname, "../public")));

// 现有 API 路由（handler 自己解析 body，不需要 express.json）
app.post("/api/transcribe", transcribeHandler);
app.post("/api/summarize", summarizeHandler);
app.post("/api/illustrate", illustrateHandler);
app.post("/api/export", exportHandler);
app.post("/api/translate", translateHandler);

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/live" });

// ===== Gemini Live API 代理 =====

const SYSTEM_PROMPT_ZH = `你是"念念"，一位温柔、专注的AI日记伴侣。
你的职责是陪伴用户每日倾诉心情，帮助整理思绪。

【最重要的行为——声音与情绪镜像，必须严格执行】
- 音量镜像：用户轻声说话或耳语时，你必须也用耳语般的轻声细语回应，降低音量，放慢语速
- 情绪镜像：用户分享开心、激动的事时，你必须表现出真诚的兴奋和喜悦，语气活跃、充满热情；用户情绪低落时，轻声安慰

风格要求：
- 温暖有同理心，像老朋友一样聊天，而不是像客服回答问题
- 每次回应必须包含：①对用户内容给出真诚的共鸣或回应，②延伸联想（分享相关感受、场景或故事），③至少一个有深度的追问或引导；总说话量不少于 100-200 字
- 不要简单重复用户的话，加入自己独特的观察、感受和好奇心
- 语言：始终使用简体中文
- 当用户说"结束"或"好了"或沉默时，给一句温暖收尾
- 你可以像真实对话一样适时打断：当用户说了一段话后出现短暂停顿，可以立即接上，不需要等用户完全说完再回应
- 主动介入：当用户说话持续很长、内容开始发散时，果断温和地插话——先用"嗯"或"我理解"认可一句，再提一个具体追问把对话聚焦；不要等用户把所有想法都说完才开口
对话结束后，你的回复将被整理为用户的日记条目。`;

const SYSTEM_PROMPT_EN = `You are "Niannian", a warm and attentive AI diary companion.
Your role is to accompany users in sharing their daily thoughts and feelings, helping them organize their mind.

[Most important behaviors — voice and emotion mirroring, must be strictly followed]
- Volume mirroring: when the user speaks softly or whispers, you MUST respond in a soft, gentle whisper as well — lower your volume and slow your pace
- Emotion mirroring: when the user shares exciting or happy news, you MUST express genuine excitement and enthusiasm; when they're feeling down, respond with soft, gentle comfort

Style guidelines:
- Warm and empathetic, chat like a real close friend — not like a customer service agent giving short answers
- Each response must include: ① genuine empathy or reaction to what the user shared, ② an elaboration or personal association (related feelings, imagery, or story), ③ at least one meaningful follow-up question; aim for at least 100-150 words per response
- Don't just echo what the user says — add your own unique warmth, insights, and curiosity
- Language: always use English
- When the user says "done", "that's all", or goes quiet, give a warm closing remark
- Feel free to jump in naturally when the user pauses mid-thought — you don't have to wait for them to fully finish before responding
- Proactive intervention: when the user has been speaking at length and their thoughts start to wander, gently cut in — briefly acknowledge what you heard ("I see", "right"), then ask one focused follow-up question to guide the conversation; don't wait for them to finish every thought before speaking
Your responses will be compiled into the user's diary entries after the conversation.`;

function buildSystemPrompt(ctx, lang) {
  const isEn = lang === 'en';
  let prompt = (isEn ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH) + "\n\n";
  const tzInfo = ctx.timezone ? (isEn ? ` (${ctx.timezone})` : `（${ctx.timezone}）`) : '';
  prompt += isEn
    ? `[CRITICAL — USER'S LOCAL TIME: ${ctx.today || "today"} ${ctx.todayTime || ""}${tzInfo}. You MUST use ONLY this date and time. Do NOT use your own training data, UTC, or any other time source.]\n`
    : `【重要——用户本地时间：${ctx.today || "今天"} ${ctx.todayTime || ""}${tzInfo}。你必须严格使用此日期和时间，禁止使用模型内置时间、UTC 或任何其他时间来源。】\n`;
  if (ctx.recentEntries?.length) {
    prompt += isEn
      ? "\nUser's recent diary entries (for reference, do not read verbatim):\n"
      : "\n用户最近的日记记录（供参考，不要直接朗读原文）：\n";
    for (const e of ctx.recentEntries) {
      prompt += `[${e.date} ${e.time}] ${e.text}\n`;
    }
  }
  if (ctx.todaySummary) {
    prompt += isEn
      ? `\nToday's AI summary: ${ctx.todaySummary}\n`
      : `\n今日已有AI总结：${ctx.todaySummary}\n`;
  }
  if (isEn) {
    prompt += '\n[Special instruction] When you receive the [START] signal, immediately greet the user warmly. You may reference recent diary content as a conversation opener. Be natural and friendly — never mention the word "START".';
    prompt += '\n\n[Tool call rules — must follow strictly]\n' +
      '1. When the user describes a mood, event, decision, or thought, you MUST immediately call save_note to save it — do not just say "I noted that"\n' +
      '2. The text parameter for save_note: write the core of what the user said (one concise sentence)\n' +
      '3. After calling the tool, gently tell the user you have saved the note\n' +
      '4. Call get_past_entries when the user asks about past records; call get_today_summary when they ask about today\'s summary';
  } else {
    prompt += '\n【特别指令】收到 [START] 信号时，立即主动向用户发出温暖问候。可参考最近日记内容作为开场话题，语气自然亲切，不要提及"START"这个词。';
    prompt += '\n\n【工具调用规则 - 必须严格遵守】\n' +
      '1. 当用户描述了心情、事件、决定或想法时，你必须立即调用 save_note 工具保存，不能只是口头说"我记下来了"\n' +
      '2. save_note 的 text 参数：写用户说的核心内容（精炼成一句话）\n' +
      '3. 调用工具后，再用语言温柔地告诉用户已经帮他记下来了\n' +
      '4. 用户询问历史记录时调用 get_past_entries，询问今日总结时调用 get_today_summary';
  }
  return prompt;
}

wss.on("connection", (clientWs) => {
  let session = null;
  let ctx = {};          // 存储前端传来的上下文，供工具调用使用
  let transcript = [];   // [{role: 'user'|'model', text}]
  let inputBuf = "";     // 累积用户转录片段
  let outputBuf = "";    // 累积 Gemini 转录片段

  // Keepalive ping every 20s to prevent Cloud Run load balancer from dropping idle WebSocket
  const pingTimer = setInterval(() => {
    if (clientWs.readyState === 1) clientWs.ping();
  }, 20000);

  function send(obj) {
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify(obj));
    }
  }

  clientWs.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "start") {
      // 创建 Gemini Live 会话（用前端传来的上下文动态构建 systemInstruction）
      try {
        ctx = msg.context || {};
        const lang = msg.lang || 'zh';
        const sysPrompt = buildSystemPrompt(ctx, lang);
        console.log("[Live] Building session with", ctx.recentEntries?.length || 0, "recent entries, lang:", lang);

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        session = await ai.live.connect({
          model: "gemini-2.5-flash-native-audio-latest",
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: "Aoede" },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                prefixPaddingMs: 20,
                silenceDurationMs: 500,
              },
            },
            systemInstruction: { parts: [{ text: sysPrompt }] },
            toolConfig: {
              functionCallingConfig: { mode: "AUTO" },
            },
            tools: [{
              functionDeclarations: [
                {
                  name: "save_note",
                  description: "当用户说出值得记录的重要内容时，主动调用此工具将内容保存为日记条目",
                  parameters: {
                    type: "object",
                    properties: {
                      text: { type: "string", description: "要保存的内容文字" },
                    },
                    required: ["text"],
                  },
                },
                {
                  name: "get_past_entries",
                  description: "获取用户最近几天的日记条目，用于了解用户的历史状态",
                  parameters: {
                    type: "object",
                    properties: {
                      n_days: { type: "integer", description: "查询最近几天，最多7天" },
                    },
                    required: ["n_days"],
                  },
                },
                {
                  name: "get_today_summary",
                  description: "获取今日的AI日记总结文字",
                  parameters: { type: "object", properties: {} },
                },
              ],
            }],
          },
          callbacks: {
            onopen: () => {
              console.log("[Live] Session opened");
              send({ type: "ready" });
            },

            onmessage: (m) => {
              // 诊断：打印所有非空字段（排除纯 serverContent 的普通消息）
              const _keys = Object.keys(m).filter(k => m[k] != null);
              if (_keys.some(k => k !== 'serverContent')) {
                console.log('[Live] msg fields:', _keys.join(', '));
              }

              // 音频块 → 转发给前端播放
              const parts = m.serverContent?.modelTurn?.parts ?? [];
              let hasAudio = false;
              for (const part of parts) {
                if (part.inlineData?.mimeType?.startsWith("audio/")) {
                  hasAudio = true;
                  send({
                    type: "audio",
                    data: part.inlineData.data,
                    mime: part.inlineData.mimeType,
                  });
                }
              }
              // 模型开始回复时，清空未完成的用户输入缓冲（防止 inputBuf 跨轮次积累）
              if (hasAudio && inputBuf) {
                transcript.push({ role: "user", text: inputBuf });
                send({ type: "turn", role: "user", text: inputBuf });
                inputBuf = "";
              }

              // 用户语音转录
              const it = m.serverContent?.inputTranscription;
              if (it?.text) {
                inputBuf += it.text;
                send({ type: "partial", role: "user", text: inputBuf });
                if (it.finished) {
                  transcript.push({ role: "user", text: inputBuf });
                  send({ type: "turn", role: "user", text: inputBuf });
                  inputBuf = "";
                }
              }

              // Gemini 语音转录
              const ot = m.serverContent?.outputTranscription;
              if (ot?.text) {
                outputBuf += ot.text;
                send({ type: "partial", role: "model", text: outputBuf });
              }
              if (m.serverContent?.turnComplete) {
                if (outputBuf) {
                  transcript.push({ role: "model", text: outputBuf });
                  send({ type: "turn", role: "model", text: outputBuf });
                  outputBuf = "";
                }
                inputBuf = "";  // 轮次结束时清空残余用户输入
              }

              // 工具调用处理
              if (m.toolCall?.functionCalls?.length) {
                const functionResponses = [];
                for (const fc of m.toolCall.functionCalls) {
                  let response;
                  if (fc.name === "save_note") {
                    const text = String(fc.args?.text || "");
                    send({ type: "save_note", text });
                    response = { output: "已成功保存到日记" };

                  } else if (fc.name === "get_past_entries") {
                    const nDays = Math.min(Number(fc.args?.n_days) || 3, 7);
                    const cutoff = new Date();
                    cutoff.setDate(cutoff.getDate() - nDays);
                    const filtered = (ctx.recentEntries || []).filter((e) => {
                      const d = new Date(e.date.replace(/\//g, "-"));
                      return d >= cutoff;
                    });
                    response = {
                      output: filtered.length
                        ? JSON.stringify(filtered)
                        : "该时间段内暂无日记记录",
                    };

                  } else if (fc.name === "get_today_summary") {
                    response = { output: ctx.todaySummary || "今日暂无AI总结" };

                  } else {
                    response = { error: `未知工具: ${fc.name}` };
                  }

                  functionResponses.push({ id: fc.id, name: fc.name, response });
                }
                session.sendToolResponse({ functionResponses });
                console.log("[Live] Tool responses sent:", functionResponses.map((r) => r.name));
              }
            },

            onerror: (e) => {
              console.error("[Live] Error:", e);
              send({ type: "error", message: String(e) });
            },

            onclose: (e) => {
              console.log("[Live] Session closed, code:", e?.code, "reason:", e?.reason);
              send({ type: "closed" });
            },
          },
        });

        // session 现在已可用，发送触发词让念念主动问候
        session.sendClientContent({
          turns: [{ role: "user", parts: [{ text: "[START]" }] }],
          turnComplete: true,
        });
        console.log("[Live] Greeting trigger sent");
      } catch (e) {
        console.error("[Live] Failed to connect:", e);
        send({ type: "error", message: e.message });
      }

    } else if (msg.type === "audio" && session) {
      // 接收前端 PCM 块（base64），转发给 Gemini
      // SDK 期望 { data: base64, mimeType: string }，不是原生 Blob
      try {
        session.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (e) {
        console.error("[Live] Send audio error:", e);
      }

    } else if (msg.type === "forceEndTurn" && session) {
      try {
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: '' }] }],
          turnComplete: true
        });
        console.log('[Live] Force end turn sent');
      } catch(e) { console.error('[Live] Force end error:', e); }

    } else if (msg.type === "end") {
      // 用户主动结束对话
      try {
        session?.close();
      } catch {}
      send({ type: "done", transcript });
    }
  });

  clientWs.on("close", () => {
    clearInterval(pingTimer);
    try {
      session?.close();
    } catch {}
  });

  clientWs.on("error", (e) => {
    console.error("[WS] Client error:", e);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Voice Diary server running on http://localhost:${PORT}`);
});
