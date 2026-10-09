import { z } from "zod";

/**
 * `POST /api/inbox/read` — Phase 37. Named entries, or all of them; never both, never neither.
 * A hundred ids is more than the bell ever shows (`INBOX_PAGE`), so a longer list is a mistake.
 */
export const markReadSchema = z.union([
  z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
