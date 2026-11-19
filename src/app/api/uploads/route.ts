import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { getCurrentSession } from "@/server/auth/current-user";
import { checkRateLimit } from "@/server/auth/rate-limit";
import { putObject, sniffFileType } from "@/server/storage";

const MAX_BYTES = 1_500_000;

/** Accepts one compressed image (products) or image/PDF (expense receipts) and returns its storage key. */
export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind");
  const file = form?.get("file");
  if ((kind !== "products" && kind !== "expenses") || !(file instanceof File)) {
    return NextResponse.json({ error: "Send a file and a valid kind" }, { status: 400 });
  }
  const permission = kind === "products" ? "products:manage" : "expenses:manage";
  if (!can(session.user.role, permission)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  if (!checkRateLimit(`upload:${session.user.id}`, 60, 60 * 60_000).allowed) {
    return NextResponse.json({ error: "Too many uploads, try again later" }, { status: 429 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "File must be smaller than 1.5 MB" }, { status: 413 });
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const type = sniffFileType(data);
  const allowed = kind === "products" ? ["webp", "jpg", "png"] : ["webp", "jpg", "png", "pdf"];
  if (!type || !allowed.includes(type)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  }

  const key = `${kind}/${randomUUID()}.${type}`;
  try {
    await putObject(key, data);
  } catch (error) {
    console.error("[upload] storage failure", error);
    return NextResponse.json({ error: "Could not store the file" }, { status: 502 });
  }
  return NextResponse.json({ key });
}
