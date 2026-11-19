import { NextResponse, type NextRequest } from "next/server";
import { getCurrentSession } from "@/server/auth/current-user";
import { contentTypeForKey, getObject, STORAGE_KEY_PATTERN } from "@/server/storage";

/** Serves stored files to signed-in staff only. Keys are validated to prevent path traversal. */
export async function GET(_request: NextRequest, { params }: RouteContext<"/api/files/[...key]">) {
  const session = await getCurrentSession();
  if (!session) return new NextResponse("Not signed in", { status: 401 });

  const { key: parts } = await params;
  const key = parts.join("/");
  if (!STORAGE_KEY_PATTERN.test(key)) return new NextResponse("Not found", { status: 404 });

  const data = await getObject(key);
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(data), {
    headers: {
      "Content-Type": contentTypeForKey(key),
      // Keys are random and immutable, so browsers can cache aggressively (privately).
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
