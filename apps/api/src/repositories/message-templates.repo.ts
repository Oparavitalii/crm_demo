import { and, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { db } from '../db/client';
import { messageTemplates, type MessageTemplate, type NewMessageTemplate } from '../db/tables/messages';
import type { ListMessageTemplatesQuery } from '@opushr/shared';

export async function list(
  query: ListMessageTemplatesQuery,
): Promise<{ items: MessageTemplate[]; total: number }> {
  const where: SQL[] = [];

  if (query.channel) where.push(eq(messageTemplates.channel, query.channel));
  if (query.q) {
    where.push(ilike(messageTemplates.name, `%${query.q}%`));
  }

  const condition = where.length ? and(...where) : undefined;
  const offset = (query.page - 1) * query.pageSize;

  const [items, totalRow] = await Promise.all([
    db.query.messageTemplates.findMany({
      where: condition,
      orderBy: desc(messageTemplates.createdAt),
      limit: query.pageSize,
      offset,
    }),
    db.select({ c: count() }).from(messageTemplates).where(condition).then((r) => r[0]),
  ]);

  return { items, total: totalRow?.c ?? 0 };
}

export async function findById(id: string): Promise<MessageTemplate | undefined> {
  return db.query.messageTemplates.findFirst({ where: eq(messageTemplates.id, id) });
}

export async function insert(input: NewMessageTemplate): Promise<MessageTemplate> {
  const [row] = await db.insert(messageTemplates).values(input).returning();
  if (!row) throw new Error('Failed to insert message template');
  return row;
}

export async function update(
  id: string,
  patch: Partial<NewMessageTemplate>,
): Promise<MessageTemplate | undefined> {
  const [row] = await db
    .update(messageTemplates)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(messageTemplates.id, id))
    .returning();
  return row;
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(messageTemplates).where(eq(messageTemplates.id, id));
  return (result.rowCount ?? 0) > 0;
}

export async function listAll(channel?: 'email' | 'sms'): Promise<MessageTemplate[]> {
  return db.query.messageTemplates.findMany({
    where: channel ? eq(messageTemplates.channel, channel) : undefined,
    orderBy: desc(messageTemplates.createdAt),
  });
}

// The single email template flagged for onboarding auto-send. Newest wins if
// more than one is (mis)configured. Undefined = auto-send not configured.
export async function findAutoSendTemplate(): Promise<MessageTemplate | undefined> {
  return db.query.messageTemplates.findFirst({
    where: and(
      eq(messageTemplates.autoSendOnCreate, true),
      eq(messageTemplates.channel, 'email'),
    ),
    orderBy: desc(messageTemplates.updatedAt),
  });
}
