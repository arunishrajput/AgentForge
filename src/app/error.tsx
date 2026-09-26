"use client";

import { Button } from "@/components/ui/button";
import { BrokenArt, EmptyState } from "@/components/ui/illustration";

/**
 * The one readable error surface for the whole app.
 *
 * Without it a thrown server error renders Next's default screen, which in
 * production says only "Application error: a client-side exception has occurred" —
 * true, and useless. This says what failed, offers the two things that actually
 * recover (retry the render, or go back to the list), and shows the digest so a
 * `gcloud run services logs read` can find the same request.
 *
 * `error.message` is deliberately not rendered. Next replaces a server error's
 * message with a generic string in production anyway, and printing whatever leaked
 * through would put internal detail on screen.
 *
 * The illustration is `BrokenArt` and not the mascot. `DESIGN.md` → *When the mascot
 * may appear*: it never replaces an error message, and on a failure it appears small
 * and `concerned` beside real text, or not at all. A cheerful sprite over someone's
 * broken page is the exact failure that rule exists to prevent.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      id="main"
      className="animate-fade mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16"
    >
      <EmptyState
        level={1}
        art={<BrokenArt />}
        title="This page could not be rendered"
        description="The workflow itself is unaffected — nothing is saved or run by loading a page. Try again, and if it keeps failing, go back to the list and reopen it."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button tone="primary" onClick={reset}>
              Try again
            </Button>
            {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- deliberate hard
                navigation: this is the escape hatch when `reset()` did not work, and a full
                document load is what discards the broken client state. */}
            <a href="/workflows" className="btn btn-quiet">
              Back to workflows
            </a>
          </div>
        }
      />

      {error.digest && (
        <p className="text-faint mt-2 text-center font-mono text-2xs">error {error.digest}</p>
      )}
    </main>
  );
}
