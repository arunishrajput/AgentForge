import { z } from "zod";

/**
 * The environment contract, enforced. Source of truth is CONTRACT.md — adding a
 * variable means updating that table, `.env.example`, and this file together.
 *
 * Validation runs once at server startup (see `src/instrumentation.ts`) so a
 * misconfigured deployment fails loudly on boot rather than at first use.
 */
const serverSchema = z.object({
  // Application queries use Neon's pooled endpoint. Cloud Run multiplies
  // connections and Neon's free compute has a low limit.
  DATABASE_URL: z.string().min(1).startsWith("postgres"),
  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url(),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  APP_BASE_URL: z.string().url(),
  CRON_SECRET: z.string().min(16),
});

/**
 * Migrations only, and read only by `drizzle.config.ts` on a developer machine
 * or in CI. Deliberately not part of the server's startup contract: the running
 * container never opens the direct endpoint, so requiring it on Cloud Run would
 * mean the app refuses to boot over a variable it does not use.
 */
const migrationSchema = z.object({
  DATABASE_URL_UNPOOLED: z.string().min(1).startsWith("postgres"),
});

function parse<T extends z.ZodType>(schema: T, context: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `Invalid ${context} environment.\n${problems}\n\n` +
        `See CONTRACT.md for the authoritative variable list and .env.example for the shape.`,
    );
  }
  return result.data;
}

/** Throws with every problem listed at once. Called from instrumentation. */
export function validateServerEnv(): void {
  parse(serverSchema, "server");
}

export function migrationEnv(): z.infer<typeof migrationSchema> {
  return parse(migrationSchema, "migration");
}

/** Reads one required variable at the point of use, with a legible failure. */
export function required(name: keyof z.infer<typeof serverSchema>): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See CONTRACT.md.`);
  }
  return value;
}
