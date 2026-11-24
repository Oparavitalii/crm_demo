/**
 * Single registry of HTTP endpoints exposed by the API.
 *
 * Why: lets the frontend hold `{ path, method, response }` triples in one
 * typed object instead of magic strings sprinkled across feature modules.
 * Backend renames now break the type check on the next `npm run typecheck`.
 *
 * Conventions:
 *  - `response` carries no runtime data — it's a `undefined as unknown as T`
 *    phantom that exists only to teach `api(route)` what it should infer.
 *  - Dynamic-param routes are arrow functions taking the params, returning
 *    a fresh descriptor. Keeps call sites readable: `routes.candidates.detail(id)`.
 *  - Group by feature module (candidates, leads, ...) so the registry mirrors
 *    the backend router mounts in `apps/api/src/index.ts`.
 *  - Only modules that have been migrated live here. Adding a module means
 *    migrating its feature-level api.ts to `api(route)` in the same change.
 */

import type {
  Candidate,
  CreateCandidateInput,
  ListCandidatesResponse,
  UpdateCandidateInput,
} from './schemas/candidate';
import type {
  CancelCandidateInput,
  DismissCandidateInput,
  HireCandidateInput,
  ListEmploymentPeriodsResponse,
  RehireCandidateInput,
} from './schemas/employment-period';
import type { ListFreelancersResponse } from './schemas/freelancer';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * A typed descriptor of one endpoint. `response` is phantom: present only
 * to seed `api<R>()` inference. `body` is shaped the same way when it helps
 * the call site (callers can still pass any shape; descriptors carry intent).
 */
export interface RouteDescriptor<TResponse, TBody = undefined> {
  readonly path: string;
  readonly method: Method;
  readonly response: TResponse;
  readonly body: TBody;
}

function route<TResponse, TBody = undefined>(
  method: Method,
  path: string,
): RouteDescriptor<TResponse, TBody> {
  return {
    path,
    method,
    // phantom values — never read at runtime, only used by inference
    response: undefined as unknown as TResponse,
    body: undefined as unknown as TBody,
  };
}

export const routes = {
  candidates: {
    list: route<ListCandidatesResponse>('GET', '/candidates'),
    create: route<Candidate, CreateCandidateInput>('POST', '/candidates'),
    detail: (id: string) => route<Candidate>('GET', `/candidates/${id}`),
    update: (id: string) =>
      route<Candidate, UpdateCandidateInput>('PATCH', `/candidates/${id}`),
    remove: (id: string) => route<null>('DELETE', `/candidates/${id}`),
    duplicates: (id: string) =>
      route<{ items: Candidate[] }>('GET', `/candidates/${id}/duplicates`),
    hire: (id: string) =>
      route<Candidate, HireCandidateInput>('POST', `/candidates/${id}/hire`),
    rehire: (id: string) =>
      route<Candidate, RehireCandidateInput>('POST', `/candidates/${id}/rehire`),
    dismiss: (id: string) =>
      route<Candidate, DismissCandidateInput>('POST', `/candidates/${id}/dismiss`),
    cancel: (id: string) =>
      route<Candidate, CancelCandidateInput>('POST', `/candidates/${id}/cancel`),
    employmentPeriods: (id: string) =>
      route<ListEmploymentPeriodsResponse>(
        'GET',
        `/candidates/${id}/employment-periods`,
      ),
  },
  freelancers: {
    // Lightweight directory used to populate the freelancerId Select on the
    // candidate list filter row. Auth required; no role guard — every user
    // who can see the candidates list can pick a freelancer to filter by.
    list: route<ListFreelancersResponse>('GET', '/freelancers'),
  },
  adminCandidates: {
    anonymize: (id: string) =>
      route<{ alreadyAnonymized: boolean; anonymizedAt: string | null }>(
        'POST',
        `/admin/candidates/${id}/anonymize`,
      ),
    // Binary download — consumed via `downloadFile(route.path, ...)`, never
    // via `api()`. Typed as `unknown` because the shared package is DOM-free
    // and the response is consumed out-of-band as a stream/blob.
    exportCandidate: (id: string) =>
      route<unknown>('GET', `/admin/candidates/${id}/export`),
  },
} as const;
