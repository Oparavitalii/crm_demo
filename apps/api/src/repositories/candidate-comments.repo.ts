import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import {
  candidateComments,
  type CandidateComment,
  type NewCandidateComment,
} from '../db/tables/candidate-comments';
import { users } from '../db/tables/users';

export type EnrichedCandidateComment = CandidateComment & {
  authorFirstName: string | null;
  authorLastName: string | null;
};

// Lists all comments for a candidate, enriched with author names via LEFT JOIN.
// Newest first. No pagination — agency volume is small (< 100 per candidate).
export async function listByCandidate(
  candidateId: string,
): Promise<EnrichedCandidateComment[]> {
  const rows = await db
    .select({
      id: candidateComments.id,
      candidateId: candidateComments.candidateId,
      authorId: candidateComments.authorId,
      body: candidateComments.body,
      createdAt: candidateComments.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(candidateComments)
    .leftJoin(users, eq(candidateComments.authorId, users.id))
    .where(eq(candidateComments.candidateId, candidateId))
    .orderBy(desc(candidateComments.createdAt));
  return rows as EnrichedCandidateComment[];
}

// Inserts a new comment and returns it enriched with author names so the API
// response is self-sufficient (frontend doesn't need an extra fetch).
export async function insert(
  input: NewCandidateComment,
): Promise<EnrichedCandidateComment> {
  const [row] = await db.insert(candidateComments).values(input).returning();
  if (!row) throw new Error('Failed to insert candidate comment');

  let authorFirstName: string | null = null;
  let authorLastName: string | null = null;
  if (row.authorId) {
    const [author] = await db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, row.authorId));
    if (author) {
      authorFirstName = author.firstName;
      authorLastName = author.lastName;
    }
  }
  return { ...row, authorFirstName, authorLastName };
}

export async function findById(
  id: string,
): Promise<CandidateComment | undefined> {
  return db.query.candidateComments.findFirst({
    where: eq(candidateComments.id, id),
  });
}

export async function remove(id: string): Promise<boolean> {
  const result = await db.delete(candidateComments).where(eq(candidateComments.id, id));
  return (result.rowCount ?? 0) > 0;
}
