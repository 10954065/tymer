import "server-only";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { AppError, isAppError, type ActionResult } from "@/lib/errors";

interface PgLikeError {
  code?: string;
  constraint?: string;
  message?: string;
}

function pgErrorOf(error: unknown): PgLikeError | null {
  if (!error || typeof error !== "object") return null;
  const direct = error as PgLikeError & { cause?: unknown };
  if (typeof direct.code === "string" && /^[0-9A-Z]{5}$/.test(direct.code)) return direct;
  if (direct.cause && typeof direct.cause === "object") return pgErrorOf(direct.cause);
  return null;
}

/** Converts known failures into safe, user-facing messages. Unknown errors are logged, never leaked. */
export function toActionError(error: unknown): Extract<ActionResult<never>, { ok: false }> {
  if (isAppError(error)) {
    return { ok: false, error: error.message, code: error.code, fieldErrors: error.fieldErrors, details: error.details };
  }
  const pg = pgErrorOf(error);
  if (pg?.code === "23505") {
    return { ok: false, error: "A record with the same unique value already exists.", code: "CONFLICT" };
  }
  if (pg?.code === "P0001" && pg.message) {
    // Raised by our own integrity triggers; the message is written for users.
    return { ok: false, error: pg.message, code: "CONFLICT" };
  }
  if (pg?.code === "23514") {
    return { ok: false, error: "The values entered break a business rule. Please review and try again.", code: "VALIDATION" };
  }
  console.error("[action] unexpected error", error);
  return { ok: false, error: "Something went wrong. Please try again.", code: "INTERNAL" };
}

export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    unstable_rethrow(error);
    return toActionError(error);
  }
}

/** Validates untrusted input with a Zod schema, raising a VALIDATION AppError with field messages. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    fieldErrors[key] ??= issue.message;
  }
  const first = result.error.issues[0];
  throw new AppError("VALIDATION", first ? first.message : "Invalid input", { fieldErrors });
}
