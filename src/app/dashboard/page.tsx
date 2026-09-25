import { redirect } from "next/navigation";

import { auth, signOut } from "@/auth";

export default async function Dashboard() {
  const session = await auth();

  // Server-side gate. Every route that reads user data re-checks this and scopes
  // its query to the owner — see ARCHITECTURE.md → API surface.
  if (!session?.user) redirect("/");

  const { name, email } = session.user;

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Signed in{name ? ` as ${name}` : ""}
        </h1>
        <p className="text-muted text-sm">{email}</p>
      </div>

      <div className="bg-surface space-y-2 rounded-lg p-5 text-sm">
        <p className="font-medium">Skeleton only — Phase 1.</p>
        <p className="text-muted">
          The canvas arrives in Phase 4, the execution engine in Phase 3, and
          natural-language workflow generation in Phase 7.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="border-muted/30 hover:bg-surface w-full rounded-lg border px-4 py-2.5 font-medium transition-colors"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
