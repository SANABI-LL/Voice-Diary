import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { text, targetLang } = await new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => resolve(JSON.parse(body)));
  });

  if (!text) return res.status(400).json({ error: "No text" });

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const targetName = targetLang === "en" ? "English" : "Simplified Chinese";
  const prompt = `Translate the following diary summary to ${targetName}. Keep the warm, personal tone. Return only the translated text, no other content:\n\n${text}`;

  try {
    const result = await model.generateContent(prompt);
    res.json({ text: result.response.text().trim() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
