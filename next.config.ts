import type { NextConfig } from "next";
import { SECURITY_HEADERS } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // Cloud Run runs a single container. `standalone` emits a self-contained
  // server bundle so the runtime image needs no node_modules install.
  output: "standalone",

  // `next dev` otherwise appends a generated block to CLAUDE.md on every run.
  // CLAUDE.md is this project's hand-authored operating contract, so the useful
  // part of that block lives in it deliberately instead — see "Framework docs".
  agentRules: false,

  // Phase 42 (D193): anti-framing and the CSP directives that need no nonce.
  async headers() {
    return [{ source: "/:path*", headers: [...SECURITY_HEADERS] }];
  },
};

export default nextConfig;
