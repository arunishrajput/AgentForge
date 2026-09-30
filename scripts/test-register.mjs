import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * A module resolve hook so `node --test` can run the TypeScript sources directly.
 *
 * Node 26 strips types from `.ts` files natively, but it still resolves ESM
 * specifiers strictly: no `@/` alias, no extensionless relative imports. Rather
 * than contort the source to suit the test runner — or install a whole test
 * framework for a handful of test files — this maps the two cases Node cannot
 * resolve on its own. No dependency, and the application code stays idiomatic.
 *
 * One constraint this buys: strip-only mode rejects TypeScript that needs real
 * transformation. No constructor parameter properties, no enums, no namespaces,
 * no decorators anywhere in `src`.
 */
const root = process.cwd();

/**
 * Structured logging writes a JSON line per run, per node and per model call (Phase 22).
 * The critical-path suites execute hundreds of workflows, so left on, a test run buries
 * its own failures under thousands of log lines. `src/lib/logging/logger.ts` reads this.
 */
process.env.AGENTFORGE_LOG_SILENT = "1";

registerHooks({
  resolve(specifier, context, nextResolve) {
    const mapped = specifier.startsWith("@/")
      ? pathToFileURL(path.join(root, "src", specifier.slice(2))).href
      : specifier;

    try {
      return nextResolve(mapped, context);
    } catch (error) {
      for (const suffix of [".ts", "/index.ts", ".tsx"]) {
        try {
          return nextResolve(mapped + suffix, context);
        } catch {
          // try the next candidate
        }
      }
      throw error;
    }
  },
});
