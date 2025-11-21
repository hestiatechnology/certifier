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
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Resend } from "resend";

const execAsync = promisify(exec);

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const templateFile = formData.get("template") as File;
    const dataJson = formData.get("data") as string;
    const mappingJson = formData.get("mapping") as string;
    const deliveryMethod = formData.get("deliveryMethod") as string || "download";
    const email = formData.get("email") as string;

    if (!templateFile || !dataJson || !mappingJson) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (deliveryMethod === 'email' && !email) {
        return NextResponse.json({ error: "Email is required for email delivery" }, { status: 400 });
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
    const buffer = Buffer.from(content);

    // Cleanup temp dir
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch (e) { console.error("Temp dir cleanup error", e)}

    // --- Delivery Logic ---

    if (deliveryMethod === 'email') {
        console.log("Starting email delivery process...");
        // 1. Upload to R2
        const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
        const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
        const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
        const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
        const RESEND_API_KEY = process.env.RESEND_API_KEY;
        const SENDER_EMAIL = process.env.SENDER_EMAIL || 'onboarding@resend.dev';

        console.log("Env Vars Check:", {
            R2_ACCOUNT_ID: !!R2_ACCOUNT_ID,
            R2_ACCESS_KEY_ID: !!R2_ACCESS_KEY_ID,
            R2_SECRET_ACCESS_KEY: !!R2_SECRET_ACCESS_KEY,
            R2_BUCKET_NAME: !!R2_BUCKET_NAME,
            RESEND_API_KEY: !!RESEND_API_KEY
        });

        if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME || !RESEND_API_KEY) {
            console.error("Missing environment variables for email delivery.");
            return NextResponse.json({ error: "Server configuration missing for email delivery (R2/Resend)" }, { status: 500 });
        }

        try {
            const s3 = new S3Client({
                region: "auto",
                endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
                credentials: {
                    accessKeyId: R2_ACCESS_KEY_ID,
                    secretAccessKey: R2_SECRET_ACCESS_KEY,
                },
            });

            const fileKey = `certificates-${uuidv4()}.zip`;
            console.log(`Uploading to R2: ${fileKey} in bucket ${R2_BUCKET_NAME}`);

            await s3.send(new PutObjectCommand({
                Bucket: R2_BUCKET_NAME,
                Key: fileKey,
                Body: buffer,
                ContentType: 'application/zip',
            }));
            console.log("R2 Upload successful.");

            // 2. Generate Presigned URL (7 days = 604800 seconds)
            const presignedUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: fileKey }),
                { expiresIn: 604800 }
            );
            console.log("Presigned URL generated.");

            // 3. Send Email
            const resend = new Resend(RESEND_API_KEY);
            console.log(`Sending email to ${email} from ${SENDER_EMAIL}`);
            
            const emailResponse = await resend.emails.send({
                from: SENDER_EMAIL,
                to: email,
                subject: 'Your Certificates are Ready',
                html: `
                    <p>Hello,</p>
                    <p>Your certificates have been successfully generated.</p>
                    <p>You can download the ZIP file using the link below (valid for 7 days):</p>
                    <p><a href="${presignedUrl}">Download Certificates.zip</a></p>
                    <p>Best regards,<br/>Certifier App</p>
                `,
            });

            if (emailResponse.error) {
                console.error("Resend API Error:", emailResponse.error);
                return NextResponse.json({ error: `Email failed: ${emailResponse.error.message}` }, { status: 500 });
            }

            console.log("Email sent successfully:", emailResponse.data);
            return NextResponse.json({ success: true, message: "Email sent successfully!" });

        } catch (innerError) {
            console.error("Error during R2/Resend operations:", innerError);
            throw innerError; // Re-throw to be caught by outer catch
        }

    } else {
        // Download directly
        return new NextResponse(new Blob([content as any]), {
            headers: {
                "Content-Type": "application/zip",
                "Content-Disposition": 'attachment; filename="certificates.zip"',
            },
        });
    }

  } catch (error) {
    console.error("Error generating certificates:", error);
    return NextResponse.json(
      { error: "Failed to generate certificates" },
      { status: 500 }
    );
  }
}

