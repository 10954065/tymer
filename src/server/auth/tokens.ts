import { createHash, randomBytes } from "node:crypto";

/** 256-bit random token encoded for cookies. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Sessions are stored by hash so a database leak cannot be replayed as cookies. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
