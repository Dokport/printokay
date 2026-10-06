/**
 * Token route for Vercel Blob client uploads.
 *
 * Large model files (.3mf can be tens of MB) exceed the ~4.5 MB serverless
 * request-body limit, so the admin uploads them straight from the browser to
 * Blob. This route issues a short-lived upload token after verifying the admin
 * session cookie. The file never passes through the function.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        // The session cookie rides along on this request from the admin page. (The
        // password used to be sent as clientPayload.)
        if (!isAdmin(req)) throw new Error("Ikke tilladt");
        // With overwrite allowed, a token for any path could replace orders.json or
        // settings.json — so only the model folder, and only plain names.
        if (!/^models\/[A-Za-z0-9_-]+\.(3mf|stl)$/i.test(pathname)) throw new Error("Ugyldig sti");
        return {
          addRandomSuffix: false,        // keep the exact pathname we chose
          allowOverwrite: true,
          maximumSizeInBytes: 200 * 1024 * 1024, // generous headroom for big projects
          allowedContentTypes: [
            "model/3mf",
            "application/zip",
            "application/octet-stream",
            "model/stl",
            "application/sla",
          ],
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do — the admin form stores the pathname on save.
      },
    });
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload-token fejlede" },
      { status: 400 }
    );
  }
}
