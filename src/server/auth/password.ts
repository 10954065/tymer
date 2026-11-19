import bcrypt from "bcryptjs";
import { AppError } from "@/lib/errors";

const BCRYPT_COST = 12;
export const MIN_PASSWORD_LENGTH = 8;

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AppError("VALIDATION", `Password must be at least ${MIN_PASSWORD_LENGTH} characters`, {
      fieldErrors: { password: `At least ${MIN_PASSWORD_LENGTH} characters` },
    });
  }
  if (password.length > 72) {
    // bcrypt only uses the first 72 bytes.
    throw new AppError("VALIDATION", "Password is too long", { fieldErrors: { password: "At most 72 characters" } });
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError("VALIDATION", "Password must contain letters and numbers", {
      fieldErrors: { password: "Use letters and numbers" },
    });
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummyHash: Promise<string> | null = null;

/** Equalises response time when the username does not exist (prevents user enumeration). */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= bcrypt.hash("timing-equaliser-not-a-real-password", BCRYPT_COST);
  await bcrypt.compare(password, await dummyHash);
}
