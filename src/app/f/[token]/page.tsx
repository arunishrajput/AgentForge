import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PublicForm } from "@/components/form/public-form";
import { Wordmark } from "@/components/shell/logo";
import { Card } from "@/components/ui/card";
import { loadPublicForm } from "@/lib/triggers/form-page";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const form = await loadPublicForm(token);
  return {
    title: form?.title || "Form",
    // The address is a credential, and a form is nobody's to index. `no-referrer` keeps it out of any
    // site a visitor goes on to, though nothing on this page links away but AgentForge's own wordmark.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * **A workflow's hosted form — Phase 40, and the fourth page a signed-out stranger can reach**
 * (`SECURITY.md` → *The unauthenticated surfaces*, D189).
 *
 * The address is the form's secret: 192 bits, the workflow row's token (D41), replaceable from the
 * trigger's panel. An address that is not a form — wrong token, a workflow with no form trigger, a
 * form that cannot be read — is the same 404 as any page that does not exist, so the page confirms
 * nothing about which tokens are real. A form that is switched off says so, to whoever holds the link.
 *
 * It follows the visitor's theme when the browser holds one and Light otherwise (D110), through the
 * root layout's head script, like every page. It is built for a phone first: a single column, large
 * touch targets, and no hover-only anything.
 */
export default async function FormPage({ params }: Props) {
  const { token } = await params;
  const form = await loadPublicForm(token);
  if (!form) notFound();

  return (
    <div className="min-h-dvh">
      <header className="border-line bg-surface border-b-2">
        <div className="mx-auto flex max-w-3xl items-center px-4 py-3 sm:px-6">
          <Wordmark />
        </div>
      </header>

      <main id="main" className="mx-auto max-w-lg px-4 py-8 sm:px-6 sm:py-12">
        {form.open ? (
          <PublicForm token={token} form={form} />
        ) : (
          <Card raised className="animate-rise p-6">
            <h1 className="text-xl font-bold tracking-tight text-pretty">{form.title || "This form"} is closed</h1>
            <p className="text-muted mt-2 text-sm text-pretty">
              It is not accepting responses right now. If you expected to fill it in, ask whoever sent you the link.
            </p>
          </Card>
        )}
        <p className="text-faint mt-6 text-center text-2xs">
          Made with AgentForge. Your answers go to whoever made this form.
        </p>
      </main>
    </div>
  );
}
