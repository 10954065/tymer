import "server-only";
import { AwsClient } from "aws4fetch";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * File storage kept outside PostgreSQL to save database storage.
 * - "local": ./uploads on the server disk (development only; serverless disks are ephemeral)
 * - "s3": any S3-compatible bucket (Cloudflare R2 free tier recommended), configured via S3_* variables
 */

export const STORAGE_KEY_PATTERN = /^(products|expenses)\/[a-f0-9-]{36}\.(webp|jpg|png|pdf)$/;

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  png: "image/png",
  pdf: "application/pdf",
};

export function contentTypeForKey(key: string): string {
  const ext = key.split(".").pop() ?? "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function driver(): "local" | "s3" {
  return process.env.STORAGE_DRIVER === "s3" ? "s3" : "local";
}

function s3(): { client: AwsClient; baseUrl: string } {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    throw new Error("S3 storage is selected but S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is missing");
  }
  return {
    client: new AwsClient({
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      service: "s3",
      region: S3_REGION || "auto",
    }),
    baseUrl: `${S3_ENDPOINT.replace(/\/$/, "")}/${S3_BUCKET}`,
  };
}

function localPath(key: string): string {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
  return path.join(process.cwd(), "uploads", ...key.split("/"));
}

export async function putObject(key: string, data: Uint8Array): Promise<void> {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
  if (driver() === "local") {
    const target = localPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    return;
  }
  const { client, baseUrl } = s3();
  const response = await client.fetch(`${baseUrl}/${key}`, {
    method: "PUT",
    body: new Blob([new Uint8Array(data)]),
    headers: { "Content-Type": contentTypeForKey(key), "Cache-Control": "private, max-age=31536000, immutable" },
  });
  if (!response.ok) throw new Error(`Upload failed with status ${response.status}`);
}

export async function getObject(key: string): Promise<Uint8Array | null> {
  if (!STORAGE_KEY_PATTERN.test(key)) return null;
  if (driver() === "local") {
    try {
      return await readFile(localPath(key));
    } catch {
      return null;
    }
  }
  const { client, baseUrl } = s3();
  const response = await client.fetch(`${baseUrl}/${key}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Detects the real file type from magic bytes (never trust the browser-supplied type). */
export function sniffFileType(data: Uint8Array): "webp" | "jpg" | "png" | "pdf" | null {
  const ascii = (start: number, length: number) => String.fromCharCode(...data.slice(start, start + length));
  if (data.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "webp";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpg";
  if (data.length >= 8 && data[0] === 0x89 && ascii(1, 3) === "PNG") return "png";
  if (data.length >= 5 && ascii(0, 5) === "%PDF-") return "pdf";
  return null;
}
