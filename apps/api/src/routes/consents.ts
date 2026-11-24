import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { confirmConsentSchema, withdrawConsentSchema } from '@crm/shared';
import * as service from '../services/consents.service';
import { buildReqCtx } from '../middleware/audit';
import { publicFormRateLimiter } from '../middleware/rate-limit';

const tokenParamSchema = z.object({ token: z.string().uuid() });

// Public router — no auth. Mounted at `/public/consents`.
// Rate-limited like the other public endpoints (10/min/IP) to bound
// token-guessing throughput.
export const publicConsentsRouter = new Hono()
  .post(
    '/withdraw',
    publicFormRateLimiter,
    zValidator('json', withdrawConsentSchema),
    async (c) => {
      const { token } = c.req.valid('json');
      const result = await service.withdrawConsent(token, buildReqCtx(c));
      return c.json(result);
    },
  )
  // Confirm page bootstraps from this — which channel checkboxes to show.
  .get(
    '/optin/:token',
    publicFormRateLimiter,
    zValidator('param', tokenParamSchema),
    async (c) => {
      const { token } = c.req.valid('param');
      const info = await service.getOptinTokenInfo(token);
      return c.json(info);
    },
  )
  // Double opt-in: turns a valid token into active consent row(s).
  .post(
    '/confirm',
    publicFormRateLimiter,
    zValidator('json', confirmConsentSchema),
    async (c) => {
      const { token, channels } = c.req.valid('json');
      const result = await service.confirmConsent(token, channels, buildReqCtx(c));
      return c.json(result);
    },
  );
