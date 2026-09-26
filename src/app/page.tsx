import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";

/**
 * The sign-in page — `DEMO.md` Beat 1, and the only page a judge sees before they
 * see the product. A signed-in visitor never reaches it.
 *
 * The three lines under the heading are the three claims the rest of the demo then
 * proves, in the order it proves them. They are on this page rather than in a
 * marketing section because this is the only screen with room to read.
 */
export default async function Home() {
  const session = await auth();

  if (session?.user) redirect("/workflows");

  return (
    <main
      id="main"
      className="relative mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-9 px-6 py-16"
    >
      {/* A single soft light behind the heading. Pointer-events none, no animation —
          it is depth, not motion, and it costs one gradient. */}
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute inset-0 -z-10"
      />

      <div className="animate-rise space-y-4">
        <p className="eyebrow text-accent">Agentic workflow automation</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Describe the automation. Get a workflow that runs.
        </h1>
        <p className="text-muted text-pretty">
          AgentForge turns a sentence into a real, executable, visually editable
          workflow — and its agent nodes reason and decide at runtime rather than
          following a fixed script.
        </p>
      </div>

      <ul
        className="animate-rise space-y-2.5"
        style={{ animationDelay: "90ms" }}
      >
        {[
          ["Built, not mocked", "Real nodes, real connections, saved to your account."],
          ["Live execution", "Per-node status and logs stream as it runs."],
          [
            "Decides at runtime",
            "Agent nodes call tools and pick a branch from what they read.",
          ],
        ].map(([title, detail]) => (
          <li key={title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="bg-accent mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
            />
            <p className="text-sm">
              <span className="font-medium">{title}</span>{" "}
              <span className="text-muted">{detail}</span>
            </p>
          </li>
        ))}
      </ul>

      <form
        className="animate-rise"
        style={{ animationDelay: "180ms" }}
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/workflows" });
        }}
      >
        <button type="submit" className="btn btn-primary w-full py-3 text-sm">
          Continue with Google
        </button>
        <p className="text-faint mt-2.5 text-2xs">
          Sign-in asks for your identity only. Access to Sheets or Gmail is a separate
          request you make later, from Settings.
        </p>
      </form>
    </main>
  );
}
