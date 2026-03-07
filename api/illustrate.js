import { GoogleGenAI } from "@google/genai";

// 当前可用的图片生成模型（2026年2月确认）
const IMAGE_MODEL = "gemini-2.5-flash-image";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { entries, summary } = await new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(JSON.parse(body)));
  });

  const contentHint = summary || (entries || []).map((e) => e.text).join("；");

  if (!contentHint.trim())
    return res.status(400).json({ error: "No content provided" });

  const prompt = `根据以下日记内容，创作一幅温暖细腻的艺术插图。
风格：柔和水彩或手绘插画，色调温暖，富有情感和意境，适合作为私人日记配图。
【严格要求】画面中绝对不能出现任何文字、字母、数字、标注、标题或符号，纯粹用画面、色彩和构图来表达情感。
日记内容：${contentHint}`;

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    let attempt = 0, imgPart = null, result = null;
    while (attempt < 3 && !imgPart) {
      attempt++;
      result = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseModalities: ["TEXT", "IMAGE"] },
      });
      imgPart = result.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!imgPart) {
        console.warn(`Illustrate attempt ${attempt}: no image returned, retrying...`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!imgPart) {
      const textParts = result?.candidates?.[0]?.content?.parts?.filter(p => p.text).map(p => p.text);
      console.error("No image after 3 attempts. Text parts:", textParts);
      return res.status(500).json({ error: "No image returned after 3 attempts", textParts });
    }

    const { mimeType, data } = imgPart.inlineData;
    res.json({ imageData: `data:${mimeType};base64,${data}` });
  } catch (e) {
    console.error("Illustrate error:", e);
    res.status(500).json({ error: e.message });
  }
}
