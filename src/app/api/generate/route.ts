import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import JSZip from "jszip";
import fs from "fs";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { v4 as uuidv4 } from "uuid";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const templateFile = formData.get("template") as File;
    const dataJson = formData.get("data") as string;
    const mappingJson = formData.get("mapping") as string;

    if (!templateFile || !dataJson || !mappingJson) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const templateBuffer = Buffer.from(await templateFile.arrayBuffer());
    const data = JSON.parse(dataJson);
    const mapping = JSON.parse(mappingJson);

    const finalZip = new JSZip();
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "certifier-"));

    // Helper to process a single item
    const processItem = async (row: any, index: number) => {
      // 1. Prepare data
      let renderData: any = row;
      
      // If mapping is provided, apply it to transform the row
      if (mapping && Object.keys(mapping).length > 0) {
        renderData = {};
        for (const [placeholder, csvColumn] of Object.entries(mapping)) {
          renderData[placeholder] = row[csvColumn as string] || "";
        }
      }

      // 2. Render DOCX
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '%', end: '%' }
      });
      doc.render(renderData);
      const docBuf = doc.getZip().generate({
        type: "nodebuffer",
        compression: "DEFLATE",
      });

      // 3. Write temp DOCX
      const id = uuidv4();
      const docxPath = path.join(tempDir, `${id}.docx`);
      const pdfPath = path.join(tempDir, `${id}.pdf`);
      
      await fs.promises.writeFile(docxPath, docBuf);

      // 4. Convert to PDF
      // --outdir is required to specify where the PDF goes
      // -env:UserInstallation is critical for server environments to avoid profile locking
      const cmd = `libreoffice -env:UserInstallation=file://${tempDir}/lo_profile --headless --convert-to pdf --outdir "${tempDir}" "${docxPath}"`;
      await execAsync(cmd);

      // 5. Read PDF
      if (fs.existsSync(pdfPath)) {
        const pdfBuf = await fs.promises.readFile(pdfPath);
        // Name the file: Use a relevant field if possible, else index
        // e.g., full_name or just row_index
        let fileName = `certificate_${index + 1}.pdf`;
        if (renderData.full_name) {
          fileName = `${renderData.full_name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        } else if (renderData.name) {
            fileName = `${renderData.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
        }
        
        finalZip.file(fileName, pdfBuf);
      } else {
        console.error(`Failed to generate PDF for row ${index}`);
      }

      // Cleanup individual files
      try {
        if (fs.existsSync(docxPath)) await fs.promises.unlink(docxPath);
        if (fs.existsSync(pdfPath)) await fs.promises.unlink(pdfPath);
      } catch (e) { console.error("Cleanup error", e)}
    };

    // Process sequentially to avoid overloading system resources
    // Alternatively, Promise.all with chunking. For now, sequential is safer for LibreOffice.
    for (let i = 0; i < data.length; i++) {
      await processItem(data[i], i);
    }

    // Generate Final ZIP
    const content = await finalZip.generateAsync({ type: "uint8array" });

    // Cleanup temp dir
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (e) { console.error("Temp dir cleanup error", e)}

    return new NextResponse(new Blob([content as any]), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="certificates.zip"',
      },
    });

  } catch (error) {
    console.error("Error generating certificates:", error);
    return NextResponse.json(
      { error: "Failed to generate certificates" },
      { status: 500 }
    );
  }
}
