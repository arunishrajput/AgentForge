import Link from "next/link";

/**
 * Reached by `notFound()` in the canvas page, which is also what another owner's
 * workflow answers — a 404 rather than a 403, deliberately, because 403 would
 * confirm the record exists (D20). The wording has to cover both cases honestly
 * without hinting which one it is.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="animate-fade mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 px-6"
    >
      <div className="space-y-2">
        <p className="eyebrow">404</p>
        <h1 className="text-xl font-semibold tracking-tight">Nothing here</h1>
        <p className="text-muted text-sm">
          This page does not exist, or it belongs to another account. Your own
          workflows are all on the list.
        </p>
      </div>

      <Link href="/workflows" className="btn btn-primary self-start">
        Back to workflows
      </Link>
    </main>
  );
}
