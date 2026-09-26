import Link from "next/link";

import { EmptyState, Mascot } from "@/components/ui/illustration";

/**
 * Reached by `notFound()` in the canvas page, which is also what another owner's
 * workflow answers — a 404 rather than a 403, deliberately, because 403 would
 * confirm the record exists (D20). The wording has to cover both cases honestly
 * without hinting which one it is.
 *
 * The mascot is allowed here, and is `thinking` rather than `concerned`: a missing
 * page is not a failed run, and nothing of the user's has broken.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="animate-fade mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16"
    >
      <EmptyState
        level={1}
        art={<Mascot mood="thinking" float className="mx-auto w-28" />}
        title="Nothing here"
        description="This page does not exist, or it belongs to another account. Your own workflows are all on the list."
        action={
          <Link href="/workflows" className="btn btn-primary">
            Back to workflows
          </Link>
        }
      />
    </main>
  );
}
