import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { userRole } from '../enums';
import { candidates } from './candidates';
import { dismissals } from './dismissals';
import { messages, messageTemplates } from './messages';
import { auditLog } from './audit-log';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: userRole('role').notNull().default('readonly'),
    twoFactorSecret: text('two_factor_secret'),
    isActive: boolean('is_active').notNull().default(true),
    isFreelancer: boolean('is_freelancer').notNull().default(false),
    // Per-user URL slug for the public application form (/apply/:slug). Lower
    // case ASCII, dash-separated. Nullable so historical / system users can
    // exist without one — only recruiters/admins get a public link. Migration
    // 0047 backfills slugs for active recruiters from first/last name.
    publicSlug: text('public_slug'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    roleIdx: index('users_role_idx').on(t.role),
    lockedUntilIdx: index('users_locked_until_idx').on(t.lockedUntil),
    publicSlugIdx: uniqueIndex('users_public_slug_idx').on(t.publicSlug),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Rotation tombstone. On /auth/refresh the old row is no longer deleted —
    // it is marked rotated and points at its replacement. This keeps access
    // tokens signed for the old sid valid until their own 15-min expiry
    // (requireAuth checks row existence) and lets a just-rotated refresh
    // token be honored within a short grace window (multi-tab race, lost
    // Set-Cookie) instead of being treated as theft. Tombstones are swept by
    // the retention cron after 24h.
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => sessions.id, {
      onDelete: 'set null',
    }),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    userIdx: index('sessions_user_id_idx').on(t.userId),
    expiresIdx: index('sessions_expires_at_idx').on(t.expiresAt),
    rotatedIdx: index('sessions_rotated_at_idx').on(t.rotatedAt),
    // Hot path: /auth/refresh resolves the session by token hash on every
    // silent refresh (each tab, every ~15 min). Rotation tombstones grow the
    // table between retention sweeps, so the lookup must not seq-scan.
    refreshHashIdx: index('sessions_refresh_token_hash_idx').on(t.refreshTokenHash),
  }),
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    tokenHashIdx: uniqueIndex('password_reset_tokens_token_hash_idx').on(t.tokenHash),
    userIdx: index('password_reset_tokens_user_id_idx').on(t.userId),
    expiresIdx: index('password_reset_tokens_expires_at_idx').on(t.expiresAt),
  }),
);

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  passwordResetTokens: many(passwordResetTokens),
  candidatesRecruited: many(candidates),
  dismissalsRecorded: many(dismissals),
  messagesSent: many(messages),
  messageTemplatesCreated: many(messageTemplates),
  auditLogEntries: many(auditLog),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const passwordResetTokensRelations = relations(
  passwordResetTokens,
  ({ one }) => ({
    user: one(users, {
      fields: [passwordResetTokens.userId],
      references: [users.id],
    }),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
