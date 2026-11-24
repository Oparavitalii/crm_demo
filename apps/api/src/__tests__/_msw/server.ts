import { setupServer } from 'msw/node';
import { handlers } from './handlers';

// Single MSW server instance reused across the whole test run.
// Tests append per-case handlers with `server.use(...)`; the
// `afterEach` hook in `setup.ts` resets back to `handlers`.
export const server = setupServer(...handlers);
