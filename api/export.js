import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } from "docx";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { entries, summaries = {}, titles = {}, illustrations = {} } =
    await new Promise((resolve) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => resolve(JSON.parse(body)));
    });

  if (!entries || entries.length === 0)
    return res.status(400).json({ error: "No entries" });

  // Group entries by date, sorted ascending
  const byDate = {};
  for (const e of entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }
  const sortedDates = Object.keys(byDate).sort();

  const children = [
    new Paragraph({
      text: "碎碎念日记",
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  ];

  for (const date of sortedDates) {
    // 日期标题
    children.push(
      new Paragraph({
        text: date,
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 400, after: 200 },
      })
    );

    // 各条目
    for (const entry of byDate[date]) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${entry.time}　`, bold: true, color: "888888" }),
            new TextRun({ text: entry.text }),
          ],
          spacing: { after: 160 },
        })
      );
    }

    // 当日标题（如有）
    if (titles[date]) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: titles[date], bold: true, size: 28, color: "b5740a" }),
          ],
          spacing: { before: 240, after: 120 },
        })
      );
    }

    // 当日总结（如有）
    if (summaries[date]) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: summaries[date], italics: true, color: "555555" }),
          ],
          spacing: { after: 240 },
        })
      );
    }

    // 插图（如有）
    if (illustrations[date]) {
      try {
        const [meta, b64] = illustrations[date].split(",");
        const imgType = meta.includes("png") ? "png" : "jpg";
        children.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: Buffer.from(b64, "base64"),
                transformation: { width: 400, height: 400 },
                type: imgType,
              }),
            ],
            spacing: { after: 300 },
          })
        );
      } catch (imgErr) {
        console.error("Image embed error for", date, imgErr.message);
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
  res.setHeader("Content-Disposition", `attachment; filename=diary.docx`);
  res.send(buffer);
}
