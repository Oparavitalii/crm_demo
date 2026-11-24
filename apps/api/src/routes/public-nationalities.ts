import { Hono } from 'hono';
import * as svc from '../services/status-lookups.service';
import { publicLookupRateLimiter } from '../middleware/rate-limit';

// Public router — no auth. Mounted at `/public/nationalities`. Returns the
// active 'nationality' lookups so the /apply/:slug form can render a real
// Select instead of a free-text input. Intentionally narrow: only this one
// lookup type is exposed publicly (we don't want recruiter-only categories
// like position / legal_status / payout_status leaking). Rate-limited to
// prevent abuse — values are small enough to cache aggressively client-side.
export const publicNationalitiesRouter = new Hono().get(
  '/',
  publicLookupRateLimiter,
  async (c) => {
    const items = await svc.listActive('nationality');
    // Trim the payload — public callers only need code + labels for the
    // Select. Hide sortOrder / isSystem / createdById etc.
    return c.json({
      items: items.map((row) => ({
        code: row.code,
        labelPl: row.labelPl,
        labelUa: row.labelUa,
      })),
    });
  },
);
