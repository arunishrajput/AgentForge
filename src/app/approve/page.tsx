import type { Metadata } from "next";

import { DecideApproval } from "@/components/approve/decide";
import { Wordmark } from "@/components/shell/logo";

export const metadata: Metadata = {
  title: "Approval",
  // A page somebody reaches from a link that is a credential. Nothing here belongs in an index.
  robots: { index: false, follow: false },
};

/**
 * **The approval link's page — Phase 38, and the third page a signed-out stranger can reach**
 * (`SECURITY.md` → *The unauthenticated surfaces*, D178).
 *
 * The link is `/approve#<token>`, and **the token is in the fragment**, which a browser never sends.
 * So this page is the same static page for everybody: it knows nothing until the script in it reads
 * the fragment, takes it out of the address bar, and POSTs it to `/api/approve/describe`. A chat
 * app's link preview — a GET of the URL — fetches this shell and learns nothing, and **nothing a GET
 * does can decide anything**: only the page's own POST to `/api/approve/decide`, after a person
 * presses a button.
 *
 * It follows the visitor's theme when the browser holds one and Light otherwise, as every page does
 * (D110) — the root layout's head script applies it before the first paint.
 */
export default function ApprovePage() {
  return (
    <div className="min-h-dvh">
      <header className="border-line bg-surface border-b-2">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3 sm:px-6">
          <Wordmark />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-lg px-4 py-12 sm:px-6">
        <DecideApproval />
      </main>
    </div>
  );
}
