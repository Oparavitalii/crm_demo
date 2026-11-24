interface NamedPerson {
  firstName?: string | null;
  lastName?: string | null;
}

export function formatFullName(p: NamedPerson, fallback = ''): string {
  return `${p.firstName ?? ''} ${p.lastName ?? ''}`.trim() || fallback;
}

export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
