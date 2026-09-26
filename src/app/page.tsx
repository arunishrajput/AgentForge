import Link from "next/link";
import { redirect } from "next/navigation";

import { auth, signIn } from "@/auth";
import { Demo } from "@/components/landing/demo";
import {
  NodeCatalogue,
  agentToolCount,
  nodeCount,
} from "@/components/landing/node-catalogue";
import { Wordmark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

/**
 * The landing page.
 *
 * `BUILD_PLAN.md` Phase 15 is blunt about why this file gets more attention than
 * any other screen: it is what a stranger arriving from GitHub sees first, and the
 * purpose of Chapter 2 is an open-source showpiece. So it is a product page — what
 * it is, what it does, a visible demonstration, and a way in — rather than the
 * Chapter 1 sign-in card, which was written for a judge who already knew what they
 * were looking at.
 *
 * Three things on it are read from the code rather than written here: the node
 * catalogue, the node count and the number of nodes the agent may call. A landing
 * page that states a number by hand is a landing page that will state the wrong
 * number within two phases.
 *
 * A signed-in visitor never reaches it — they go straight to their workflows.
 */
export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/workflows");

  async function startSignIn() {
    "use server";
    await signIn("google", { redirectTo: "/workflows" });
  }

  const nodes = nodeCount();
  const tools = agentToolCount();

  return (
    <>
      <header className="border-line bg-surface border-b-2">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <Wordmark />
          <nav aria-label="About this project" className="ml-auto flex items-center gap-1">
            <Link href="/design" className="btn btn-ghost">
              Design system
            </Link>
            <a
              href={REPOSITORY}
              target="_blank"
              rel="noreferrer"
              className="btn btn-ghost hidden sm:inline-flex"
            >
              Source
            </a>
          </nav>
          <SignInForm action={startSignIn} tone="quiet" label="Sign in" />
        </div>
      </header>

      <main id="main">
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden px-4 pt-14 pb-12 sm:px-6 sm:pt-20 sm:pb-16">
          <div
            aria-hidden="true"
            className="hero-glow pointer-events-none absolute inset-0 -z-10"
          />
          <div className="mx-auto max-w-3xl text-center">
            <p className="eyebrow text-accent animate-rise">
              Open source · agentic workflow automation
            </p>
            <h1 className="animate-rise mt-3 text-3xl font-bold tracking-tight text-balance sm:text-5xl">
              Describe the automation. Get a workflow that runs.
            </h1>
            <p className="text-muted animate-rise mx-auto mt-4 max-w-xl text-base text-pretty sm:text-lg">
              AgentForge turns a sentence into a real, executable, visually editable
              workflow — and its agent nodes reason and decide at runtime instead of
              following a fixed script.
            </p>

            <div
              className="animate-rise mt-7 flex flex-wrap items-center justify-center gap-2.5"
              style={{ animationDelay: "90ms" }}
            >
              <SignInForm action={startSignIn} tone="ink" label="Continue with Google" size="lg" />
              <Link href="/design" className="btn btn-quiet px-5 py-2.5 text-sm">
                See the design system
              </Link>
            </div>
            <p className="text-faint mx-auto mt-3 max-w-md text-2xs text-pretty">
              Sign-in asks for your identity only. Access to Sheets or Gmail is a separate
              request you make later, from Settings.
            </p>

            <ul
              className="animate-rise mt-9 flex flex-wrap items-center justify-center gap-2"
              style={{ animationDelay: "180ms" }}
            >
              {[
                `${nodes} nodes in the registry`,
                `${tools} of them callable by an agent`,
                "Live per-node streaming",
                "Free to run",
              ].map((fact) => (
                <li key={fact} className="chip bg-surface">
                  {fact}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── The demonstration ────────────────────────────────────────────── */}
        <Section
          id="how"
          eyebrow="The whole product, in one picture"
          title="From one sentence to a running workflow"
          lead="Nothing here is a preview surface. The workflow is saved to your account the moment it is built, opens on the canvas, and runs on the same engine as everything else."
        >
          <Demo />
        </Section>

        {/* ── What you get ─────────────────────────────────────────────────── */}
        <Section
          eyebrow="What you actually get"
          title="A workflow, not a suggestion"
          tint
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Feature
              title="Built, then validated, then saved"
              body="Every generated graph is checked node by node and edge by edge against the registry before it is stored. A workflow that could not run is reported as problems you can see, not saved as a hopeful draft."
            />
            <Feature
              title="Agents decide at runtime"
              body={`The agent node calls tools and picks its branch from what it reads. Its tool set is derived from the registry — ${tools} nodes, and nothing else. There is no shell node, no filesystem node, and no arbitrary code execution anywhere in the product.`}
            />
            <Feature
              title="You watch it run"
              body="Per-node status and logs stream to the canvas as the run happens, including the agent's tool calls and the branch it took. Reload mid-run and the page reattaches to the same stream."
            />
            <Feature
              title="It starts without you"
              body="A manual run, an unguessable webhook URL, or a cron schedule in UTC. Triggers are ordinary nodes, so a workflow can carry more than one."
            />
          </div>
        </Section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <Section eyebrow="How it works" title="Three steps, and you can stop after any of them">
          <ol className="grid gap-4 sm:grid-cols-3">
            {[
              [
                "Describe it",
                "Plain language, in the box at the top of your workflow list. The model answers with a graph; the server checks that graph against the registry before anything is saved.",
              ],
              [
                "Edit anything",
                "It is a real canvas. Move nodes, rewire edges, change any node's configuration, add a trigger, delete the half you did not want.",
              ],
              [
                "Run it and watch",
                "Statuses and logs arrive as they happen. When it is right, give it a webhook or a schedule and leave it alone.",
              ],
            ].map(([title, body], index) => (
              <li key={title} className="card p-5">
                <span
                  aria-hidden="true"
                  className="border-line bg-accent-pop text-ink grid size-8 place-items-center rounded-xl border-2 text-sm font-bold"
                >
                  {index + 1}
                </span>
                <h3 className="mt-3 text-base font-bold">{title}</h3>
                <p className="text-muted mt-1.5 text-sm text-pretty">{body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ── The registry ─────────────────────────────────────────────────── */}
        <Section
          eyebrow="The node catalogue"
          title={`${nodes} nodes, read from the registry as this page rendered`}
          lead="One table in the codebase feeds three things: the engine's dispatch, the canvas palette, and the agent's tool set. This list is that table, so it cannot advertise a node the product does not have."
          tint
        >
          <NodeCatalogue />
        </Section>

        {/* ── Open source ──────────────────────────────────────────────────── */}
        <Section eyebrow="Built to be read" title="The repository is part of the product">
          <div className="grid gap-4 sm:grid-cols-3">
            <Feature
              title="Free to operate"
              body="Cloud Run's always-free tier, Neon's free Postgres, and your own Gemini key. There is no paid infrastructure anywhere in it, and that is a rule rather than a coincidence."
            />
            <Feature
              title="Checked on every push"
              body="Lint, typecheck, the test suite and a production build all run in CI before anything lands. A red pipeline stops the work."
            />
            <Feature
              title="A design system you can look at"
              body={
                <>
                  Every token, primitive and motion state lives on one page, with its
                  contrast ratio computed rather than claimed —{" "}
                  <Link href="/design" className="text-accent font-semibold hover:underline">
                    /design
                  </Link>
                  .
                </>
              }
            />
          </div>
        </Section>

        {/* ── Closing call to action ───────────────────────────────────────── */}
        <section className="px-4 pt-4 pb-16 sm:px-6">
          <Card className="mx-auto max-w-2xl p-7 text-center sm:p-9">
            <h2 className="text-2xl font-bold tracking-tight text-balance">
              Describe the first one.
            </h2>
            <p className="text-muted mx-auto mt-2 max-w-md text-sm text-pretty">
              Sign in with Google, type a sentence, and you will be looking at a workflow
              you can run in about five seconds.
            </p>
            <div className="mt-5 flex justify-center">
              <SignInForm action={startSignIn} tone="ink" label="Continue with Google" size="lg" />
            </div>
          </Card>
        </section>
      </main>

      <footer className="border-line bg-surface border-t-2">
        <div className="text-muted mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-6 text-2xs sm:px-6">
          <Wordmark className="text-ink" />
          <nav aria-label="Project links" className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={REPOSITORY} target="_blank" rel="noreferrer" className="hover:text-ink">
              Source
            </a>
            <Link href="/design" className="hover:text-ink">
              Design system
            </Link>
            <a
              href="https://devpost.com/software/agentforge-kz832x"
              target="_blank"
              rel="noreferrer"
              className="hover:text-ink"
            >
              Devpost
            </a>
          </nav>
          <p className="ml-auto">Built for the Zero Origin hackathon, and kept going since.</p>
        </div>
      </footer>
    </>
  );
}

const REPOSITORY = "https://github.com/arunishrajput/AgentForge";

/**
 * Sign-in is a server action on a real form, not a click handler: `signIn` sets an
 * httpOnly cookie and redirects, neither of which a client fetch can do. The same
 * action is used by all three buttons on the page.
 */
function SignInForm({
  action,
  label,
  tone,
  size = "md",
}: {
  action: () => Promise<void>;
  label: string;
  tone: "ink" | "quiet";
  size?: "md" | "lg";
}) {
  return (
    <form action={action}>
      <Button type="submit" tone={tone} size={size}>
        {label}
      </Button>
    </form>
  );
}

/** A page section: one heading, one optional lead, and whatever it is about. */
function Section({
  id,
  eyebrow,
  title,
  lead,
  tint = false,
  children,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  lead?: string;
  /** A band on the sunken surface, to break a long page into parts. */
  tint?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn("px-4 py-14 sm:px-6 sm:py-16", tint && "border-line bg-sunken border-y-2")}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow text-accent">{eyebrow}</p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
            {title}
          </h2>
          {lead && <p className="text-muted mt-3 text-sm text-pretty sm:text-base">{lead}</p>}
        </div>
        <div className="mt-9">{children}</div>
      </div>
    </section>
  );
}

function Feature({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h3 className="text-base font-bold">{title}</h3>
      <p className="text-muted mt-1.5 text-sm text-pretty">{body}</p>
    </div>
  );
}
