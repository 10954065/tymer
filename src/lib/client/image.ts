/**
 * Browser-side image compression before upload: resizes to at most `maxSize` px and encodes WebP.
 * A typical phone photo (3–6 MB) becomes ~40–120 KB, keeping storage and bandwidth costs low.
 */
export async function compressImage(file: File, maxSize = 800, quality = 0.8): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is not supported in this browser");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("Could not compress the image");
  return blob;
}

export async function uploadFile(blob: Blob, kind: "products" | "expenses", filename: string): Promise<string> {
  const body = new FormData();
  body.append("kind", kind);
  body.append("file", blob, filename);
  const response = await fetch("/api/uploads", { method: "POST", body });
  const payload = (await response.json().catch(() => ({}))) as { key?: string; error?: string };
  if (!response.ok || !payload.key) throw new Error(payload.error ?? "Upload failed");
  return payload.key;
}

export function fileUrl(key: string): string {
  return `/api/files/${key}`;
}
