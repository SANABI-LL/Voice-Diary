import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { entries, lang } = await new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(JSON.parse(body)));
  });

  if (!entries || entries.length === 0)
    return res.status(400).json({ error: "No entries" });

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const isEn = lang === 'en';

  const entriesText = isEn
    ? entries.map((e, i) => `[Entry ${i + 1} - ${e.time}]\n${e.text}`).join("\n\n")
    : entries.map((e, i) => `[第${i + 1}条 - ${e.time}]\n${e.text}`).join("\n\n");

  const prompt = isEn
    ? `The following are entries the user recorded throughout today:

${entriesText}

As a caring life coach, please write a constructive daily summary based on these entries:
1. Briefly summarize what happened today (2-3 sentences, don't repeat entries verbatim)
2. Reflect on the user's emotional state or patterns worth noticing
3. Give 2-3 specific, actionable suggestions to help them improve or move forward
4. Remind them of any unfinished items if applicable
5. Tone: warm and direct, like a friend — not a formal report
6. Length: moderate, around 150-300 words

Return JSON only with two fields:
- "title": a short, punchy title (under 8 words) capturing today's theme and mood
- "summary": the life-coach-style summary (meeting requirements 1-6 above)
Return only the JSON, no other text.`
    : `以下是用户今天分多次用语音记录的内容：

${entriesText}

请作为一位贴心的生活教练，基于这些记录给出一份有建设性的今日总结。要求：
1. 简短概括今天发生了什么（2-3句，不要逐条重复原话）
2. 分析情绪或状态，指出值得关注的模式或倾向
3. 给出2-3条具体可行的建议或行动，帮助用户改善现状或推进目标
4. 如有未完成事项，提醒跟进
5. 语气温暖、直接，像朋友而非报告
6. 长度适中，200-400字左右

请以 JSON 格式返回，包含两个字段：
- "title"：一个简短有力的标题（10字以内），能概括今天的主题和情绪，自由发挥，不限风格
- "summary"：生活教练风格的总结（满足以上1-6条要求）
只返回 JSON，不要有其他文字。`;

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim();
    const cleaned = raw.replace(/^```json\s*|^```\s*|```$/gm, "").trim();
    const { title, summary } = JSON.parse(cleaned);
    res.json({ title, summary });
  } catch (e) {
    console.error(e);
    const status = e.status === 429 ? 429 : 500;
    res.status(status).json({ error: e.message, rateLimited: status === 429 });
  }
}
