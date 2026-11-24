import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// Auto-managed MSW lifecycle for unit tests. Wired in via
// `vitest.config.ts -> test.setupFiles`.
//
// `onUnhandledRequest: 'warn'` (not 'error') is a deliberate choice for now:
//   - Most tests that touch external I/O stub the client at the module level
//     (`vi.mock('resend', ...)`, `vi.mock('../clients/r2.client', ...)`),
//     which short-circuits before any fetch happens — MSW never sees those.
//   - A handful of tests do reach fetch (e.g. when R2 client isn't mocked).
//     Until every such test is verified to be covered by a handler in
//     `handlers.ts`, 'error' would break the suite. 'warn' logs the gap so
//     we can audit it without flipping the whole baseline red.
//
// Once the suite is fully MSW-aware, flip this to 'error' so a forgotten
// outbound call fails the test rather than silently hitting the network.
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
