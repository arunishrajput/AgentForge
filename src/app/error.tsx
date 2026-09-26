"use client";

/**
 * The one readable error surface for the whole app (BUILD_PLAN Phase 10, task 5).
 *
 * Without it a thrown server error renders Next's default screen, which in
 * production says only "Application error: a client-side exception has occurred" —
 * true, and useless on stage. This says what failed, offers the two things that
 * actually recover (retry the render, or go back to the list), and shows the digest
 * so a `gcloud run services logs read` can find the same request.
 *
 * `error.message` is deliberately not rendered. Next replaces a server error's
 * message with a generic string in production anyway, and printing whatever leaked
 * through would put internal detail on screen.
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
      className="animate-fade mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6"
    >
      <div className="space-y-2">
        <p className="eyebrow text-bad">Something broke</p>
        <h1 className="text-xl font-semibold tracking-tight">
          This page could not be rendered
        </h1>
        <p className="text-muted text-sm">
          The workflow itself is unaffected — nothing is saved or run by loading a
          page. Try again, and if it keeps failing, go back to the list and reopen it.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={reset} className="btn btn-primary">
          Try again
        </button>
        {/* oxlint-disable-next-line nextjs/no-html-link-for-pages -- deliberate hard navigation:
            this is the escape hatch when `reset()` did not work, and a full document load
            is what discards the broken client state. */}
        <a href="/workflows" className="btn btn-quiet">
          Back to workflows
        </a>
      </div>

      {error.digest && (
        <p className="text-faint font-mono text-2xs">error {error.digest}</p>
      )}
    </main>
  );
}
