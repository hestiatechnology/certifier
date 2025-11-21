import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = new PizZip(buffer);
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '%', end: '%' }
    });

    const text = doc.getFullText();
    // Regex to find %variable% patterns
    // Matches %variable% or % variable %
    const regex = /%\s*([\w\d_\-]+)\s*%/g;
    const matches = new Set<string>();
    let match;

    while ((match = regex.exec(text)) !== null) {
      matches.add(match[1]);
    }

    return NextResponse.json({ placeholders: Array.from(matches) });
  } catch (error) {
    console.error("Error analyzing DOCX:", error);
    return NextResponse.json(
      { error: "Failed to analyze DOCX file" },
      { status: 500 }
    );
  }
}
