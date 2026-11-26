import { z } from "zod";

/**
 * Zod 4 probes `new Function("")` to decide whether to use its JIT fast path. Under the strict script CSP
 * (src/lib/security/csp.ts, no 'unsafe-eval') the probe is blocked and reported as a CSP violation even though
 * Zod handles the failure. `jitless` skips the probe; validation behaviour is unchanged.
 */
z.config({ jitless: true });
