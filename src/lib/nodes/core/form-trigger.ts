import { FORM_TRIGGER_TYPE, formConfigSchema } from "@/lib/triggers/form";

import { defineNode } from "../types";

/**
 * **Starts a run when somebody fills in this workflow's hosted form — Phase 40** (D189).
 *
 * The page at `/f/<token>` and the route behind it are `triggers/form.ts`'s and the receiver's; this
 * node is the declaration they both read: the fields, and what the visitor is told. **The server
 * validates every submission against these fields before a run exists** — a missing required field,
 * a malformed email or a choice that is not on the list is refused with a message per field, costs one
 * indexed select and starts nothing. By the time `execute` runs, the input is a clean object holding
 * exactly the declared fields and nothing else.
 *
 * The URL's token is the workflow row's (D41), not this config's, for the webhook trigger's reasons.
 *
 * Run by hand from the editor, there is no visitor: the input is whatever the run box supplies, and
 * `execute` hands it on unchanged — so the steps after the form can be tried without filling it in.
 */
export const formTrigger = defineNode({
  type: FORM_TRIGGER_TYPE,
  label: "Form trigger",
  // Not one of the triggers sent with every request (D191), so it may say how its fields are written.
  description:
    "Starts the workflow when someone submits a hosted web form. Use it when the request says a form, a sign-up, a survey or a contact page. " +
    'Declare "fields": a list of { "name": "email", "label": "Your email", "type": text|longtext|email|number|select|checkbox|date, "required": true, ' +
    '"options": "A, B, C" (select only) }. Each answer is then {{trigger.<name>}}.',
  kind: "trigger",
  category: "trigger",
  outputs: [{ key: null, label: "Out" }],
  outputShape: "an object with one key per field, e.g. {{trigger.email}}. A checkbox is true or false; a number is a number.",
  configSchema: formConfigSchema,
  docs: {
    summary:
      "A web page anyone with the link can fill in — no sign-in. Add the fields you want (a name, a label, a type, whether it is required) and each answer becomes a value your steps can use. The link is secret and can be replaced from the trigger's panel. Add a Respond step to change what the visitor is told.",
    accepts: "nothing — it starts the run. Field names are what you reach as {{trigger.name}}",
    examples: [
      { title: "A field's answer", body: "{{trigger.email}}" },
      { title: "A field set up as a choice", body: 'name: plan · type: select · options: "Free, Team, Enterprise"' },
      { title: "Tell the visitor something specific", body: "Add a Respond step with status 200 and body message: Thanks {{trigger.name}}" },
    ],
  },
  async execute({ input, context }) {
    const keys =
      input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input as Record<string, unknown>) : [];
    context.log(
      keys.length > 0 ? `Form submitted with ${keys.length} field(s): ${keys.join(", ")}.` : "Form submitted with no fields.",
    );
    return { output: input ?? {} };
  },
});
