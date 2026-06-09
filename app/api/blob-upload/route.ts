/**
 * Token route for Vercel Blob client uploads.
 *
 * Large model files (.3mf can be tens of MB) exceed the ~4.5 MB serverless
 * request-body limit, so the admin uploads them straight from the browser to
 * Blob. This route issues a short-lived upload token after verifying the admin
 * (passed as clientPayload). The file never passes through the function.
 */
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        // Admin auth: the client sends the admin token as clientPayload.
        if (!process.env.ADMIN_PASSWORD || clientPayload !== process.env.ADMIN_PASSWORD) {
          throw new Error("Ikke tilladt");
        }
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
