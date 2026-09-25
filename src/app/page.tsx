import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

export default async function Home() {
  const session = await auth();

  if (session?.user) redirect("/workflows");

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">AgentForge</h1>
        <p className="text-muted text-balance">
          Describe what you want in plain language. AgentForge builds a real,
          executable, visually editable workflow whose agent nodes reason and decide
          at runtime.
        </p>
      </div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/workflows" });
        }}
      >
        <button
          type="submit"
          className="bg-accent text-canvas w-full rounded-lg px-4 py-2.5 font-medium transition-opacity hover:opacity-90"
        >
          Continue with Google
        </button>
      </form>

      <p className="text-muted text-sm">
        Health check:{" "}
        <Link className="underline underline-offset-4" href="/api/health">
          /api/health
        </Link>
      </p>
    </main>
  );
}
