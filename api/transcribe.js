import { GoogleGenerativeAI } from "@google/generative-ai";
import formidable from "formidable";
import { readFileSync } from "fs";

export const config = {
  api: { bodyParser: false },
};

function parseForm(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({ keepExtensions: true });
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  try {
    const { files } = await parseForm(req);

    const audioFile = files.audio?.[0] || files.audio;
    if (!audioFile) {
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const audioBuffer = readFileSync(audioFile.filepath);
    const mimeType = (audioFile.mimetype || "audio/webm").split(";")[0];
    console.log("Audio size:", audioBuffer.length, "MIME:", mimeType);

    const audioBase64 = audioBuffer.toString("base64");

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const result = await model.generateContent([
      { inlineData: { mimeType, data: audioBase64 } },
      "请把这段语音完整转录成文字。只输出转录的文字内容，不要添加任何解释。",
    ]);

    const text = result.response.text().trim();
    console.log("Transcription result:", JSON.stringify(text));
    res.json({ text });
  } catch (e) {
    console.error("Transcribe error:", e);
    res.status(500).json({ error: e.message });
  }
}
