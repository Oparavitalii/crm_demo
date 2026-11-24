import { z } from 'zod';
import { idSchema, optionalTrimmedString, paginationSchema } from './common';

// F16 + 2026-06-02 simplification: tasks/reminders module. Tasks may be
// per-candidate (created from a candidate detail page) or standalone (created
// from the Tasks sidebar panel — candidateId stays null).
// Types kept for backward compat but UI defaults all new tasks to 'other'.
export const TASK_TYPES = ['contact', 'email', 'other'] as const;
export const taskTypeSchema = z.enum(TASK_TYPES);
export type TaskType = z.infer<typeof taskTypeSchema>;

// 4-state workflow. 'completed' / 'cancelled' are terminal. doneAt is
// auto-managed by the service when status moves to / away from 'completed'.
export const TASK_STATUSES = ['new', 'in_work', 'completed', 'cancelled'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const createTaskSchema = z.object({
  // Optional — standalone tasks (no candidate context) leave it null.
  candidateId: idSchema.nullish(),
  // Required — every task has someone responsible.
  assigneeId: idSchema,
  type: taskTypeSchema.optional(),
  title: z.string().trim().min(1).max(500),
  description: optionalTrimmedString(5000),
  dueAt: z.string().datetime().nullish(),
  status: taskStatusSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  assigneeId: idSchema.optional(),
  type: taskTypeSchema.optional(),
  title: z.string().trim().min(1).max(500).optional(),
  description: optionalTrimmedString(5000),
  status: taskStatusSchema.optional(),
  dueAt: z.string().datetime().nullish(),
  // Legacy toggle path — frontend may still send doneAt; service syncs status.
  doneAt: z.string().datetime().nullish(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const taskSchema = z.object({
  id: idSchema,
  candidateId: idSchema.nullable(),
  assigneeId: idSchema.nullable(),
  type: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  dueAt: z.string().datetime().nullable(),
  doneAt: z.string().datetime().nullable(),
  createdById: idSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Enriched optional fields (LEFT JOIN to users / candidates).
  assigneeFirstName: z.string().nullable().optional(),
  assigneeLastName: z.string().nullable().optional(),
  candidateFirstName: z.string().nullable().optional(),
  candidateLastName: z.string().nullable().optional(),
  // 2026-06-13: surface the creator's name in the list ("who assigned this
  // task"). Same LEFT-JOIN-to-users pattern as assignee. Nullable because
  // tasks created via webhook/cron have createdById = null.
  createdByFirstName: z.string().nullable().optional(),
  createdByLastName: z.string().nullable().optional(),
});
export type Task = z.infer<typeof taskSchema>;

export const listTasksQuerySchema = paginationSchema.extend({
  candidateId: idSchema.optional(),
  assigneeId: idSchema.optional(),
  type: taskTypeSchema.optional(),
  status: taskStatusSchema.optional(),
  // Legacy 'open'/'done' filter. 'open' = status NOT IN (completed,cancelled),
  // 'done' = status IN (completed,cancelled). Kept for back-compat with widget.
  state: z.enum(['open', 'done', 'all']).default('all'),
  overdueOnly: z.coerce.boolean().optional(),
  dueTodayOnly: z.coerce.boolean().optional(),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

export const listTasksResponseSchema = z.object({
  items: z.array(taskSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export type ListTasksResponse = z.infer<typeof listTasksResponseSchema>;
