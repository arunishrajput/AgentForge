import { redirect } from "next/navigation";

import { auth } from "@/auth";

/**
 * Phase 1's landing page. The signed-in home is now the workflow list; this stays
 * so an existing link or bookmark still lands somewhere useful.
 */
export default async function Dashboard() {
  const session = await auth();
  redirect(session?.user ? "/workflows" : "/");
}
