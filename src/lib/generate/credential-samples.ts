/**
 * A credential of every kind the product stores, shaped as its provider issues it — Phase 36, for
 * the tests that prove none reaches a prompt (`scrub.test.ts`, `evidence.test.ts`). Test data only;
 * nothing in the product imports it.
 *
 * **Built from parts at run time, never written out whole** — a literal shaped like a live GitHub
 * token or Slack webhook in a public repository is exactly what secret scanning exists to stop,
 * and a test should not teach a reader to commit one. None of these is a real credential.
 */
export const CREDENTIAL_SAMPLES: Record<string, string[]> = {
  "llm.google": [["AI", "za", "Sy", "Xq7".repeat(11)].join("")],
  "llm.groq": [["gs", "k_", "Q1w2E3r4".repeat(7)].join("")],
  "google.oauth": [["1/", "/0", "gHiJkLmN-oPqRsTuV_wXyZ".repeat(4)].join(""), ["ya", "29.", "a0AfB_byC1d2E3f4G5".repeat(5)].join("")],
  "integration.discord": [["https://discord.com/api/web", "hooks/1234567890123456789/", "AbCdEf-ghIJ_kl".repeat(5)].join("")],
  "integration.slack": [["https://hooks.slack", ".com/services/T0AAAAAAA/B0BBBBBBB/", "cCcCcCcCcCcC".repeat(2)].join("")],
  "integration.notion": [["sec", "ret_", "N0t1onS3cr3t".repeat(4)].join(""), ["nt", "n_", "N0t1onT0k3n".repeat(4)].join("")],
  "integration.github": [["gh", "p_", "G1tHubT0k3n".repeat(4)].join(""), ["github", "_pat_", "11ABCDEFG0_".repeat(8)].join("")],
  "integration.airtable": [["p", "at", "Ab12Cd34Ef56Gh", ".", "0123456789abcdef".repeat(4)].join("")],
  "integration.postgres": [["postgres", "ql://reader:s3cr3t-pass@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"].join("")],
};
