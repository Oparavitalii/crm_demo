import { z } from 'zod';
import { emailSchema } from './common';
import { publicUserSchema } from './user';

export const loginSchema = z.object({
  email: emailSchema,
  // max 200 chars prevents large-body DoS via bcrypt CPU burn
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const resetRequestSchema = z.object({
  email: emailSchema,
});
export type ResetRequestInput = z.infer<typeof resetRequestSchema>;

export const resetConfirmSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(12).max(200),
});
export type ResetConfirmInput = z.infer<typeof resetConfirmSchema>;

export const loginResponseSchema = z.object({
  user: publicUserSchema,
  accessToken: z.string().optional(),
  refreshToken: z.string().optional(),
  partialToken: z.string().optional(),
  requires2FA: z.boolean().optional(),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export const verify2FAInputSchema = z.object({
  partialToken: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export type Verify2FAInput = z.infer<typeof verify2FAInputSchema>;

export const enroll2FAResponseSchema = z.object({
  secret: z.string(),
  uri: z.string(),
  qrCodeDataUrl: z.string(),
});
export type Enroll2FAResponse = z.infer<typeof enroll2FAResponseSchema>;

export const confirm2FAInputSchema = z.object({
  secret: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export type Confirm2FAInput = z.infer<typeof confirm2FAInputSchema>;

export const disable2FAInputSchema = z.object({
  password: z.string(),
  code: z.string().regex(/^\d{6}$/),
});
export type Disable2FAInput = z.infer<typeof disable2FAInputSchema>;
