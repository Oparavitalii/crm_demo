import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/candidate-comments.repo', () => ({
  listByCandidate: vi.fn(),
  insert: vi.fn(),
  findById: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../services/candidates.service', () => ({
  getCandidate: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/candidate-comments.repo';
import * as candidatesService from '../services/candidates.service';
import * as audit from '../services/audit.service';
import { ForbiddenError, NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const otherRecruiter = { id: 'rec-2', role: 'recruiter' as const };

const candidateId = 'cand-1';
const ctx = { ip: null, userAgent: null };

const baseComment = {
  id: 'cmt-1',
  candidateId,
  authorId: 'rec-1',
  body: 'Spoke with client',
  createdAt: new Date(),
  authorFirstName: 'Anna',
  authorLastName: 'Recruiter',
};

// Minimal stub returned by candidatesService.getCandidate when the candidate
// is visible to the actor — only the .id field is consumed downstream.
const visibleCandidate = { id: candidateId } as never;

beforeEach(() => vi.clearAllMocks());

describe('candidate-comments.service.createComment', () => {
  it('sets authorId to actor.id and calls repo.insert with correct args', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(visibleCandidate);
    vi.mocked(repo.insert).mockResolvedValue(baseComment);
    const { createComment } = await import('../services/candidate-comments.service');
    const result = await createComment(
      candidateId,
      { body: 'Spoke with client' },
      recruiterUser,
      ctx,
    );
    expect(result.id).toBe('cmt-1');
    expect(repo.insert).toHaveBeenCalledWith({
      candidateId,
      authorId: 'rec-1',
      body: 'Spoke with client',
    });
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it('throws NotFoundError if candidate is hidden by RBAC scope', async () => {
    vi.mocked(candidatesService.getCandidate).mockRejectedValue(
      new NotFoundError('candidate'),
    );
    const { createComment } = await import('../services/candidate-comments.service');
    await expect(
      createComment(candidateId, { body: 'hi' }, otherRecruiter, ctx),
    ).rejects.toThrow(NotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe('candidate-comments.service.listComments', () => {
  it('runs RBAC check first then returns repo result', async () => {
    vi.mocked(candidatesService.getCandidate).mockResolvedValue(visibleCandidate);
    vi.mocked(repo.listByCandidate).mockResolvedValue([baseComment]);
    const { listComments } = await import('../services/candidate-comments.service');
    const result = await listComments(candidateId, recruiterUser);
    expect(candidatesService.getCandidate).toHaveBeenCalledWith(
      candidateId,
      recruiterUser,
    );
    expect(result.total).toBe(1);
    expect(result.items[0]?.id).toBe('cmt-1');
  });
});

describe('candidate-comments.service.deleteComment', () => {
  it('admin can delete any comment', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseComment,
      authorId: 'someone-else',
    });
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteComment } = await import('../services/candidate-comments.service');
    await expect(deleteComment('cmt-1', adminUser, ctx)).resolves.toBeUndefined();
    expect(repo.remove).toHaveBeenCalledWith('cmt-1');
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it('author can delete their own comment', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseComment,
      authorId: 'rec-1',
    });
    vi.mocked(repo.remove).mockResolvedValue(true);
    const { deleteComment } = await import('../services/candidate-comments.service');
    await expect(deleteComment('cmt-1', recruiterUser, ctx)).resolves.toBeUndefined();
    expect(repo.remove).toHaveBeenCalledWith('cmt-1');
  });

  it('non-admin non-author gets ForbiddenError', async () => {
    vi.mocked(repo.findById).mockResolvedValue({
      ...baseComment,
      authorId: 'rec-1',
    });
    const { deleteComment } = await import('../services/candidate-comments.service');
    await expect(
      deleteComment('cmt-1', otherRecruiter, ctx),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.remove).not.toHaveBeenCalled();
    // Guard against regression: if audit.log were called above the auth check,
    // unauthorized delete attempts would leak audit entries. Order matters.
    expect(audit.log).not.toHaveBeenCalled();
  });
});
