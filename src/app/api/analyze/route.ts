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
    
    // Regex for standard placeholders %variable%
    // Exclude patterns starting with # or / (which are loops)
    const varRegex = /%(?![#/])\s*([\w\d_\-]+)\s*%/g;
    const placeholders = new Set<string>();
    let match;
    while ((match = varRegex.exec(text)) !== null) {
      placeholders.add(match[1]);
    }

    // Regex for loop tags: matches both {#loop} and %#loop%
    const loopRegex = /(?:\{|%)\s*#\s*([\w\d_\-]+)\s*(?:\}|%)/g;
    const loops = new Set<string>();
    while ((match = loopRegex.exec(text)) !== null) {
      loops.add(match[1]);
    }

    return NextResponse.json({ 
      placeholders: Array.from(placeholders),
      loops: Array.from(loops)
    });
  } catch (error) {
    console.error("Error analyzing DOCX:", error);
    return NextResponse.json(
      { error: "Failed to analyze DOCX file" },
      { status: 500 }
    );
  }
}
