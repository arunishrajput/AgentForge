import { handle, ok, requireScope } from "@/lib/api";
import { finishOnboarding } from "@/lib/onboarding/onboarding";

export const dynamic = "force-dynamic";

/**
 * `POST /api/onboarding` — finish the first-run guide, for good.
 *
 * One idempotent write and the guide never returns. There is deliberately no `GET`: the
 * guide's progress is read on the server by the page that draws it, and a second way to
 * ask the same question is a second place for the answer to drift.
 *
 * **`viewer` is enough**, which is the lowest bar any write in this product has. What it
 * changes is whether a checklist is drawn; it grants nothing and reveals nothing, and a
 * viewer who has read the guide and cannot dismiss it is worse served than a workspace
 * whose checklist one of its members hid. The reasoning is in `finishOnboarding`.
 *
 * There is no body. "Skipped" and "completed" are the same state — the guide is finished
 * with — and recording which of the two it was would be a number nobody acts on.
 */
export async function POST() {
  return handle(async () => {
    const scope = await requireScope();
    await finishOnboarding(scope);
    return ok({ onboarded: true });
  });
}
