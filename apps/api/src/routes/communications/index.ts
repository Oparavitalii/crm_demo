import { Hono } from 'hono';
import { templatesRouter } from './templates';
import { sendRouter } from './send';

export const communicationsRouter = new Hono()
  .route('/templates', templatesRouter)
  .route('/', sendRouter);
