import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.JWT_SECRET = 'a'.repeat(48);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(48);
process.env.DATABASE_URL = 'postgres://x@y/z';
process.env.DATABASE_URL_DIRECT = 'postgres://x@y/z';
process.env.R2_ENDPOINT = 'https://example.com';
process.env.R2_ACCESS_KEY = 'x';
process.env.R2_SECRET_KEY = 'x';
process.env.R2_BUCKET = 'x';

vi.mock('../repositories/projects.repo', () => ({
  list: vi.fn(),
  findById: vi.fn(),
  findByName: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../services/audit.service', () => ({ log: vi.fn() }));
vi.mock('../lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as repo from '../repositories/projects.repo';
import * as audit from '../services/audit.service';
import { AppError, ForbiddenError, NotFoundError } from '../lib/errors';

const adminUser = { id: 'admin-1', role: 'admin' as const };
const recruiterUser = { id: 'rec-1', role: 'recruiter' as const };
const coordinatorUser = { id: 'coord-1', role: 'coordinator' as const };

const ctx = { ip: '1.2.3.4', userAgent: 'jest' };

const baseProject = {
  id: 'proj-1',
  name: 'Project Alpha',
  isActive: true,
  notes: null,
  headcountNeeded: 0,
  startDate: null,
  headcountResetAt: new Date('2026-01-01T00:00:00Z'),
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

const baseProjectWithMetrics = {
  ...baseProject,
  foundCount: 0,
  missingCount: 0,
  percentFilled: 0,
};

beforeEach(() => vi.clearAllMocks());

describe('projects.service.listProjects', () => {
  it('returns paginated result with page/pageSize from query', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [baseProjectWithMetrics], total: 1 });
    const { listProjects } = await import('../services/projects.service');
    const result = await listProjects(
      { page: 1, pageSize: 100, isActive: true } as never,
      adminUser,
    );
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(100);
  });

  it('forwards search query (q) and isActive filter to repo', async () => {
    vi.mocked(repo.list).mockResolvedValue({ items: [], total: 0 });
    const { listProjects } = await import('../services/projects.service');
    const query = { page: 1, pageSize: 50, q: 'Alpha', isActive: false } as never;
    await listProjects(query, adminUser);
    expect(vi.mocked(repo.list).mock.calls[0]?.[0]).toEqual(query);
  });
});

describe('projects.service.getProject', () => {
  it('returns project when found', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    const { getProject } = await import('../services/projects.service');
    const result = await getProject('proj-1', adminUser);
    expect(result.id).toBe('proj-1');
  });

  it('throws NotFoundError when missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { getProject } = await import('../services/projects.service');
    await expect(getProject('proj-missing', adminUser)).rejects.toThrow(NotFoundError);
  });
});

describe('projects.service.createProject', () => {
  const createInput = {
    name: 'Project Beta',
    isActive: true,
    notes: null,
    headcountNeeded: 20,
    startDate: '2026-05-20',
  };

  it('admin can create project and audit is written', async () => {
    vi.mocked(repo.findByName).mockResolvedValue(undefined);
    vi.mocked(repo.insert).mockResolvedValue({ ...baseProject, name: 'Project Beta' });
    const { createProject } = await import('../services/projects.service');
    const result = await createProject(createInput, adminUser, ctx);
    expect(result.name).toBe('Project Beta');
    expect(audit.log).toHaveBeenCalledOnce();
    const auditArg = vi.mocked(audit.log).mock.calls[0]?.[0];
    expect(auditArg?.action).toBe('create_project');
    expect(auditArg?.actorId).toBe('admin-1');
  });

  it('recruiter cannot create (admin-only)', async () => {
    const { createProject } = await import('../services/projects.service');
    await expect(createProject(createInput, recruiterUser, ctx)).rejects.toThrow(
      ForbiddenError,
    );
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('coordinator cannot create (admin-only)', async () => {
    const { createProject } = await import('../services/projects.service');
    await expect(createProject(createInput, coordinatorUser, ctx)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('throws DUPLICATE when name already exists', async () => {
    vi.mocked(repo.findByName).mockResolvedValue(baseProject);
    const { createProject } = await import('../services/projects.service');
    await expect(
      createProject({ ...createInput, name: 'Project Alpha' }, adminUser, ctx),
    ).rejects.toThrow(AppError);
    expect(repo.insert).not.toHaveBeenCalled();
  });
});

describe('projects.service.updateProject', () => {
  it('admin can update and audit is written', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    vi.mocked(repo.update).mockResolvedValue({ ...baseProject, isActive: false });
    const { updateProject } = await import('../services/projects.service');
    const result = await updateProject('proj-1', { isActive: false }, adminUser, ctx);
    expect(result.isActive).toBe(false);
    expect(audit.log).toHaveBeenCalledOnce();
  });

  it('recruiter cannot update (admin-only)', async () => {
    const { updateProject } = await import('../services/projects.service');
    await expect(
      updateProject('proj-1', { isActive: false }, recruiterUser, ctx),
    ).rejects.toThrow(ForbiddenError);
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when project missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { updateProject } = await import('../services/projects.service');
    await expect(
      updateProject('proj-missing', { isActive: false }, adminUser, ctx),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws DUPLICATE when renaming to existing name', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    vi.mocked(repo.findByName).mockResolvedValue({ ...baseProject, id: 'proj-other', name: 'Taken' });
    const { updateProject } = await import('../services/projects.service');
    await expect(
      updateProject('proj-1', { name: 'Taken' }, adminUser, ctx),
    ).rejects.toThrow(AppError);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('does NOT check name uniqueness when name unchanged', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    vi.mocked(repo.update).mockResolvedValue({ ...baseProject, notes: 'updated' });
    const { updateProject } = await import('../services/projects.service');
    await updateProject('proj-1', { notes: 'updated' }, adminUser, ctx);
    expect(repo.findByName).not.toHaveBeenCalled();
  });
});

describe('projects.service.deleteProject', () => {
  it('admin can delete + audit BEFORE remove', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    const order: string[] = [];
    vi.mocked(audit.log).mockImplementation(async () => {
      order.push('audit');
    });
    vi.mocked(repo.remove).mockImplementation(async () => {
      order.push('remove');
      return true;
    });
    const { deleteProject } = await import('../services/projects.service');
    await deleteProject('proj-1', adminUser, ctx);
    expect(order).toEqual(['audit', 'remove']);
  });

  it('recruiter cannot delete (admin-only)', async () => {
    const { deleteProject } = await import('../services/projects.service');
    await expect(deleteProject('proj-1', recruiterUser, ctx)).rejects.toThrow(
      ForbiddenError,
    );
    expect(repo.findById).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when project missing', async () => {
    vi.mocked(repo.findById).mockResolvedValue(undefined);
    const { deleteProject } = await import('../services/projects.service');
    await expect(deleteProject('proj-missing', adminUser, ctx)).rejects.toThrow(
      NotFoundError,
    );
    expect(repo.remove).not.toHaveBeenCalled();
  });

  it('translates FK violation (23503) to HAS_REFERENCES AppError', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    const fkError = Object.assign(new Error('FK violation'), {
      code: '23503',
      constraint: 'candidates_project_id_fkey',
    });
    vi.mocked(repo.remove).mockRejectedValue(fkError);
    const { deleteProject } = await import('../services/projects.service');
    try {
      await deleteProject('proj-1', adminUser, ctx);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('HAS_REFERENCES');
      expect((err as AppError).status).toBe(409);
    }
  });

  it('rethrows non-FK errors as-is', async () => {
    vi.mocked(repo.findById).mockResolvedValue(baseProject);
    const oops = new Error('connection lost');
    vi.mocked(repo.remove).mockRejectedValue(oops);
    const { deleteProject } = await import('../services/projects.service');
    await expect(deleteProject('proj-1', adminUser, ctx)).rejects.toThrow('connection lost');
  });
});
