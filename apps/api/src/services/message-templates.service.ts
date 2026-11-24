import sanitizeHtml from 'sanitize-html';
import type { MessageTemplate } from '../db/tables/messages';
import * as repo from '../repositories/message-templates.repo';
import * as audit from './audit.service';
import { NotFoundError, ForbiddenError } from '../lib/errors';
import type {
  CreateMessageTemplateInput,
  ListMessageTemplatesQuery,
  UpdateMessageTemplateInput,
} from '@opushr/shared';

/**
 * I-1: Sanitize HTML body to prevent stored XSS.
 * Applied on every write (create & update).
 */
function sanitizeTemplateBody(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre'],
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

/**
 * I-1 bonus: Strip all HTML from subject (must be plain text).
 */
function sanitizeTemplateSubject(subject: string): string {
  return sanitizeHtml(subject, { allowedTags: [] });
}

interface Actor {
  id: string;
  role: 'admin' | 'recruiter' | 'coordinator' | 'readonly';
}
interface ReqCtx {
  ip: string | null;
  userAgent: string | null;
}

function canManage(role: Actor['role']): boolean {
  return role === 'admin' || role === 'recruiter';
}

export async function listTemplates(
  query: ListMessageTemplatesQuery,
  _actor: Actor,
): Promise<{ items: MessageTemplate[]; total: number; page: number; pageSize: number }> {
  const { items, total } = await repo.list(query);
  return { items, total, page: query.page, pageSize: query.pageSize };
}

export async function getTemplate(id: string, _actor: Actor): Promise<MessageTemplate> {
  const row = await repo.findById(id);
  if (!row) throw new NotFoundError('message_template');
  return row;
}

export async function createTemplate(
  input: CreateMessageTemplateInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<MessageTemplate> {
  if (!canManage(actor.role)) throw new ForbiddenError('admin or recruiter only');

  const row = await repo.insert({
    name: input.name,
    channel: input.channel,
    subject: input.subject != null ? sanitizeTemplateSubject(input.subject) : null,
    body: sanitizeTemplateBody(input.body),
    variables: input.variables,
    // Onboarding auto-send is an email-only concept; never honor it on SMS.
    autoSendOnCreate: input.channel === 'email' ? input.autoSendOnCreate === true : false,
    createdById: actor.id,
  });

  await audit.log({
    actorId: actor.id,
    action: 'create_message_template',
    entityType: 'message_template',
    entityId: row.id,
    newValue: { name: row.name, channel: row.channel },
    ...ctx,
  });

  return row;
}

export async function updateTemplate(
  id: string,
  patch: UpdateMessageTemplateInput,
  actor: Actor,
  ctx: ReqCtx,
): Promise<MessageTemplate> {
  if (!canManage(actor.role)) throw new ForbiddenError('admin or recruiter only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('message_template');

  // Auto-send stays email-only: if the (possibly newly-set) channel isn't
  // email, force the flag off regardless of what was submitted.
  const effectiveChannel = patch.channel ?? existing.channel;
  const row = await repo.update(id, {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.channel !== undefined && { channel: patch.channel }),
    ...(patch.subject !== undefined && { subject: patch.subject != null ? sanitizeTemplateSubject(patch.subject) : null }),
    ...(patch.body !== undefined && { body: sanitizeTemplateBody(patch.body) }),
    ...(patch.variables !== undefined && { variables: patch.variables }),
    ...(patch.autoSendOnCreate !== undefined && {
      autoSendOnCreate: effectiveChannel === 'email' ? patch.autoSendOnCreate : false,
    }),
    ...(patch.channel !== undefined && patch.channel !== 'email' && { autoSendOnCreate: false }),
  });
  if (!row) throw new NotFoundError('message_template');

  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
    oldValue[key] = (existing as Record<string, unknown>)[key as string];
    newValue[key] = (row as Record<string, unknown>)[key as string];
  }

  await audit.log({
    actorId: actor.id,
    action: 'update_message_template',
    entityType: 'message_template',
    entityId: id,
    oldValue,
    newValue,
    ...ctx,
  });

  return row;
}

export async function deleteTemplate(
  id: string,
  actor: Actor,
  ctx: ReqCtx,
): Promise<void> {
  if (!canManage(actor.role)) throw new ForbiddenError('admin or recruiter only');

  const existing = await repo.findById(id);
  if (!existing) throw new NotFoundError('message_template');

  // Audit BEFORE delete — never lose the trail if the audit insert fails.
  await audit.log({
    actorId: actor.id,
    action: 'delete_message_template',
    entityType: 'message_template',
    entityId: id,
    oldValue: { name: existing.name, channel: existing.channel },
    ...ctx,
  });

  await repo.remove(id);
}
