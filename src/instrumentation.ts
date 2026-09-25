import { validateServerEnv } from "@/lib/env";

/**
 * Next runs this once when the server process starts, before it handles requests.
 * Validating here — rather than at module scope somewhere — keeps `next build`
 * free of env requirements while still failing on a misconfigured deployment.
 *
 * In production the process is killed rather than left to throw. Verified in
 * Phase 1: when `register` throws, Next keeps the container listening on $PORT
 * and answers every request with a 500. Cloud Run would read that open port as a
 * healthy revision, shift traffic onto it, and serve nothing but errors. Exiting
 * makes the revision fail to start, so Cloud Run keeps the previous one and the
 * deploy fails loudly — which is the behaviour DEPLOYMENT.md's verification assumes.
 */
export function register(): void {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    validateServerEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\nAgentForge failed to start.\n\n${message}\n`);

    if (process.env.NODE_ENV === "production") process.exit(1);
    throw error;
  }
}
