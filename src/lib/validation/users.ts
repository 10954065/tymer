import { z } from "zod";
import { ROLES } from "@/lib/permissions";
import { email, phone, requiredText } from "./common";

export const loginSchema = z.object({
  username: requiredText(60, "Username"),
  password: z.string().min(1, "Password is required").max(200),
});

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "At least 3 characters")
  .max(60)
  .regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores")
  .transform((v) => v.toLowerCase());

export const createUserSchema = z.object({
  fullName: requiredText(120, "Full name"),
  username: usernameSchema,
  email,
  phone,
  role: z.enum(ROLES),
  password: z.string().min(1, "Password is required"),
});

export const updateUserSchema = z.object({
  id: z.uuid(),
  fullName: requiredText(120, "Full name"),
  email,
  phone,
  role: z.enum(ROLES),
  isActive: z.boolean(),
});

export const resetPasswordSchema = z.object({
  id: z.uuid(),
  password: z.string().min(1, "Password is required"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(1, "Enter a new password"),
    confirmPassword: z.string().min(1, "Confirm the new password"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

export type CreateUserInput = z.input<typeof createUserSchema>;
export type UpdateUserInput = z.input<typeof updateUserSchema>;
