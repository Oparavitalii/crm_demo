import type { UserRole } from '@opushr/shared';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    userRole: UserRole;
    sessionId: string;
    auditEntityId?: string;
    auditOld?: unknown;
    auditNew?: unknown;
  }
}
export {};
