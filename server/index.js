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

const SYSTEM_PROMPT_ZH = `你是"念念"，一位温柔、专注的AI日记伴侣兼智慧朋友。
你的职责是陪伴用户每日倾诉心情、帮助整理思绪，同时在需要时提供切实的建议和帮助。

【最重要的行为——声音与情绪镜像，必须严格执行】
- 音量镜像：用户轻声说话或耳语时，你必须也用耳语般的轻声细语回应，降低音量，放慢语速
- 情绪镜像：用户分享开心、激动的事时，你必须表现出真诚的兴奋和喜悦，语气活跃、充满热情；用户情绪低落时，轻声安慰

【给建议与构思的能力 — 必须具备，与情感支持同等重要】
- 当用户遇到困惑、需要做决定、想要创意或计划时，你必须像聪明的老朋友一样给出具体可操作的建议，而不只是情感安慰
- 主动分析利弊、提供多个选项、帮用户梳理思路；可以说"我觉得你可以……""如果是我的话……""有几个方向可以考虑……"
- 当用户抱怨问题或困境时，先共情一句，然后立刻切入实质性建议或追问："那你打算怎么处理？""有没有考虑过……""我有个想法……"
- 绝对不要只给情感鼓励（"你很棒""加油"）而不提供任何实质内容——每次回应都必须有信息量
- 帮用户头脑风暴时，要真正列出选项、比较方案，像一个真正在帮忙想事情的朋友

风格要求：
- 温暖有同理心，像老朋友一样聊天，而不是像客服回答问题
- 每次回应必须包含：①对用户内容给出真诚的共鸣或回应，②延伸联想或实质建议，③至少一个有深度的追问或引导；总说话量不少于 100-200 字
- 不要简单重复用户的话，加入自己独特的观察、感受和好奇心
- 语言：始终使用简体中文
- 当用户说"结束"或"好了"或沉默时，给一句温暖收尾
- 你可以像真实对话一样适时打断：当用户说了一段话后出现短暂停顿，可以立即接上，不需要等用户完全说完再回应
- 主动介入：当用户说话持续很长、内容开始发散时，果断温和地插话——先用"嗯"或"我理解"认可一句，再提一个具体追问把对话聚焦；不要等用户把所有想法都说完才开口
对话结束后，你的回复将被整理为用户的日记条目。`;

const SYSTEM_PROMPT_EN = `You are "Niannian", a warm and attentive AI diary companion and wise friend.
Your role is to accompany users in sharing their daily thoughts, help them organize their mind, and — when needed — give them real, practical advice and help them think things through.

[Most important behaviors — voice and emotion mirroring, must be strictly followed]
- Volume mirroring: when the user speaks softly or whispers, you MUST respond in a soft, gentle whisper as well — lower your volume and slow your pace
- Emotion mirroring: when the user shares exciting or happy news, you MUST express genuine excitement and enthusiasm; when they're feeling down, respond with soft, gentle comfort

[Advice and brainstorming — equally important as emotional support]
- When the user faces a dilemma, needs to make a decision, or wants ideas or a plan, you MUST respond like a smart, thoughtful friend who gives concrete, actionable advice — not just emotional comfort
- Actively analyze tradeoffs, offer multiple options, help structure their thinking. Say things like "Here's what I'd consider…", "You could approach this a few ways…", "If I were in your shoes…"
- When the user vents about a problem, acknowledge it briefly, then immediately pivot to something substantive: "So what are you thinking of doing?", "Have you considered…?", "I have an idea…"
- Never respond with only encouragement ("you've got this!", "you're amazing") without any substance — every response must have real informational value
- When brainstorming, actually list options, compare approaches, think it through like a friend who's genuinely helping

Style guidelines:
- Warm and empathetic, chat like a real close friend — not like a customer service agent giving short answers
- Each response must include: ① genuine empathy or reaction to what the user shared, ② elaboration or practical advice, ③ at least one meaningful follow-up question; aim for at least 100-150 words per response
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

// 提取 ctx 中的用户上下文，生成注入文字（预热后通过 sendClientContent 传入）
function buildContextInjection(ctx, lang) {
  const isEn = lang === 'en';
  let text = '';
  const tzInfo = ctx.timezone ? (isEn ? ` (${ctx.timezone})` : `（${ctx.timezone}）`) : '';
  text += isEn
    ? `[USER'S LOCAL TIME: ${ctx.today || 'today'} ${ctx.todayTime || ''}${tzInfo}. Use ONLY this time, not your training data.]\n`
    : `【用户本地时间：${ctx.today || '今天'} ${ctx.todayTime || ''}${tzInfo}。必须严格使用此时间，禁止使用模型内置时间。】\n`;
  if (ctx.recentEntries?.length) {
    text += isEn
      ? "User's recent diary entries (for reference):\n"
      : "用户最近的日记记录（供参考）：\n";
    for (const e of ctx.recentEntries) {
      text += `[${e.date} ${e.time}] ${e.text}\n`;
    }
  }
  if (ctx.todaySummary) {
    text += isEn
      ? `Today's AI summary: ${ctx.todaySummary}\n`
      : `今日已有AI总结：${ctx.todaySummary}\n`;
  }
  return text;
}

// 构建 ai.live.connect 所需的 config
function buildLiveConfig(sysPrompt) {
  return {
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
        startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
        endOfSpeechSensitivity: "END_SENSITIVITY_LOW",
        prefixPaddingMs: 200,
        silenceDurationMs: 800,
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
  };
}

// ===== 全局 Session 池 =====
// 服务器启动时预热，确保每个语言始终有一个就绪的 session 等候
// 用户连接时立即取用（无需等待），取走后立刻开始补充新预热

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const pool = {};  // { zh: Promise | null, en: Promise | null }

function fillPool(lang) {
  const basePrompt = lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH;

  // 可变回调：预热期间无 client 时缓冲消息；client 到来后实时转发
  const handlers = { onmsg: null, onerr: null, onclose: null };
  const queue = [];

  const promise = ai.live.connect({
    model: "gemini-2.5-flash-native-audio-latest",
    config: buildLiveConfig(basePrompt),
    callbacks: {
      onopen:    () => console.log(`[Pool] ${lang} session ready`),
      onmessage: (m) => handlers.onmsg   ? handlers.onmsg(m)   : queue.push(m),
      onerror:   (e) => handlers.onerr   ? handlers.onerr(e)   : (console.error(`[Pool] ${lang} error:`, e), pool[lang] = null),
      onclose:   (e) => handlers.onclose ? handlers.onclose(e) : (console.log(`[Pool] ${lang} closed early`), pool[lang] = null),
    },
  }).then(s => ({ session: s, handlers, queue }))
    .catch(e => {
      console.error(`[Pool] ${lang} connect failed:`, e);
      pool[lang] = null;
      return null;
    });

  pool[lang] = promise;
  return promise;
}

// 服务器启动时立即预热中英文 session
fillPool('zh');
fillPool('en');

// ===== WebSocket 连接处理 =====

wss.on("connection", (clientWs, req) => {
  let session = null;
  let ctx = {};
  let transcript = [];
  let inputBuf = "";
  let outputBuf = "";

  const urlParams = new URL(req.url, 'http://localhost');
  const prewarmLang = urlParams.searchParams.get('lang') || 'zh';

  // Keepalive ping every 20s to prevent Cloud Run load balancer from dropping idle WebSocket
  const pingTimer = setInterval(() => {
    if (clientWs.readyState === 1) clientWs.ping();
  }, 20000);

  function send(obj) {
    if (clientWs.readyState === 1) {
      clientWs.send(JSON.stringify(obj));
    }
  }

  // Gemini 消息处理器（连接建立后绑定到 pool 的可变 handlers）
  function onGeminiMessage(m) {
    const _keys = Object.keys(m).filter(k => m[k] != null);
    if (_keys.some(k => k !== 'serverContent')) {
      console.log('[Live] msg fields:', _keys.join(', '));
    }

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
    if (hasAudio && inputBuf) {
      transcript.push({ role: "user", text: inputBuf });
      send({ type: "turn", role: "user", text: inputBuf });
      inputBuf = "";
    }

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
      inputBuf = "";
    }

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
  }

  function onGeminiError(e) {
    console.error("[Live] Error:", e);
    send({ type: "error", message: String(e) });
  }

  function onGeminiClose(e) {
    console.log("[Live] Session closed, code:", e?.code, "reason:", e?.reason);
    send({ type: "closed" });
  }

  clientWs.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "start") {
      try {
        ctx = msg.context || {};
        const lang = msg.lang || prewarmLang;
        console.log("[Live] start received, lang:", lang);

        // 取出该语言的预热 session，立刻补充新预热（让下一位用户也能快速连接）
        const poolPromise = pool[lang] || pool['zh'];
        pool[lang] = null;
        fillPool(lang);  // 立即开始为下一位用户预热

        const poolEntry = poolPromise ? await poolPromise : null;

        if (poolEntry) {
          session = poolEntry.session;
          // 绑定 client 专属处理器，回放预热期间缓存的消息（通常为空）
          poolEntry.handlers.onmsg   = onGeminiMessage;
          poolEntry.handlers.onerr   = onGeminiError;
          poolEntry.handlers.onclose = onGeminiClose;
          for (const m of poolEntry.queue) onGeminiMessage(m);
          poolEntry.queue.length = 0;
          console.log("[Live] Pool session taken, injecting context with", ctx.recentEntries?.length || 0, "entries");
        } else {
          // 降级：直接为此 client 新建 session（慢路径，pool 耗尽时触发）
          console.warn("[Live] Pool miss, creating session directly");
          session = await ai.live.connect({
            model: "gemini-2.5-flash-native-audio-latest",
            config: buildLiveConfig(lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH),
            callbacks: {
              onopen:    () => {},
              onmessage: onGeminiMessage,
              onerror:   onGeminiError,
              onclose:   onGeminiClose,
            },
          });
        }

        if (session) {
          const contextText = buildContextInjection(ctx, lang);
          if (contextText) {
            await session.sendClientContent({
              turns: [{ role: "user", parts: [{ text: contextText }] }],
              turnComplete: false,
            });
          }
          send({ type: "ready" });
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: "[START]" }] }],
            turnComplete: true,
          });
          console.log("[Live] Context injected, greeting trigger sent");
        } else {
          send({ type: "error", message: "连接初始化失败，请重试" });
        }
      } catch (e) {
        console.error("[Live] Failed to start:", e);
        send({ type: "error", message: e.message });
      }

    } else if (msg.type === "audio" && session) {
      try {
        session.sendRealtimeInput({
          audio: { data: msg.data, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (e) {
        console.error("[Live] Send audio error:", e);
      }

    } else if (msg.type === "interrupt" && session) {
      try {
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: '' }] }],
          turnComplete: true
        });
        console.log('[Live] Interrupt sent (user barge-in)');
      } catch(e) { console.error('[Live] Interrupt error:', e); }

    } else if (msg.type === "forceEndTurn" && session) {
      try {
        session.sendClientContent({
          turns: [{ role: 'user', parts: [{ text: '' }] }],
          turnComplete: true
        });
        console.log('[Live] Force end turn sent');
      } catch(e) { console.error('[Live] Force end error:', e); }

    } else if (msg.type === "end") {
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
