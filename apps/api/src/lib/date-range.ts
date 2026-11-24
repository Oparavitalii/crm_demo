import type { DateRangePreset } from '@crm/shared';

// Resolve a date-range filter to absolute since/until timestamps.
// Mirrors logic in analytics.service.resolveRange so list pages and the
// dashboard share the same semantics.
//
// `until` is exclusive (UTC midnight of the day AFTER the end-of-range).
// Returns nulls when the range is unbounded (preset='all' or 'custom' with
// missing endpoints).
export function resolveDateRange(input: {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
}): { since: Date | null; until: Date | null } {
  const preset = input.preset ?? 'all';

  if (preset === 'all') return { since: null, until: null };

  if (preset === 'custom') {
    return {
      since: input.from ? new Date(input.from) : null,
      until: input.to ? new Date(input.to) : null,
    };
  }

  const now = new Date();
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  switch (preset) {
    case 'today':
      return { since: startOfToday, until: null };
    case '7d': {
      const since = new Date(startOfToday);
      since.setUTCDate(since.getUTCDate() - 6);
      return { since, until: null };
    }
    case '30d': {
      const since = new Date(startOfToday);
      since.setUTCDate(since.getUTCDate() - 29);
      return { since, until: null };
    }
    case 'thisMonth':
      return {
        since: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        until: null,
      };
    case 'lastMonth': {
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const until = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { since, until };
    }
    case 'quarter': {
      const since = new Date(startOfToday);
      since.setUTCDate(since.getUTCDate() - 89);
      return { since, until: null };
    }
    default:
      return { since: null, until: null };
  }
}
