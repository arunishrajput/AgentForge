import { cache } from "react";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { workflows } from "@/db/schema";
import { WEBHOOK_TOKEN_PATTERN } from "@/lib/triggers/webhook";

import { formTriggerNode, optionsOf, readFormConfig, type FormFieldType } from "./form";

/**
 * **What the public form page is allowed to know — Phase 40.** The page is rendered for a stranger,
 * so this is the whole of what leaves the server: the form's own words and fields, and whether it is
 * open. Never the workflow's name, id, owner, workspace or graph — a visitor learns what the form
 * asks and nothing about the product behind it (`SECURITY.md` → *The unauthenticated surfaces*).
 *
 * Cached per request so the page and its metadata read the row once.
 */
export interface PublicForm {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  failureMessage: string;
  fields: { name: string; label: string; type: FormFieldType; required: boolean; options: string[] }[];
}

export const loadPublicForm = cache(async (token: string): Promise<PublicForm | null> => {
  // The same shape check the receiver makes, so a scan of this page costs no query either.
  if (!WEBHOOK_TOKEN_PATTERN.test(token)) return null;

  const [workflow] = await db().select().from(workflows).where(eq(workflows.webhookToken, token)).limit(1);
  const node = workflow ? formTriggerNode(workflow.graph) : undefined;
  const config = node ? readFormConfig(node) : null;
  if (!workflow || !config) return null;

  return {
    open: workflow.active,
    title: config.title,
    description: config.description,
    submitLabel: config.submitLabel,
    successMessage: config.successMessage,
    failureMessage: config.failureMessage,
    fields: config.fields.map((field) => ({
      name: field.name,
      label: field.label,
      type: field.type,
      required: field.required,
      options: field.type === "select" ? optionsOf(field) : [],
    })),
  };
});
