/**
 * **The generation eval set — Phase 34.**
 *
 * Twenty-four requests a stranger might type, each with what a correct answer must contain.
 * They exist for two jobs, and the second is the one that justified building them:
 *
 *  1. **Measure generation** rather than eyeball it. A live run (`npm run eval:generate --
 *     --live`) sends every case to a real model and scores the answer; a recording of that run
 *     is replayed offline in CI (`eval.test.ts`), so the pipeline is held to real model output
 *     without a network call.
 *  2. **Prove the catalogue selector does not drop a node a request needed.** Generation sends
 *     full definitions only for the nodes selected for a request (`select.ts`). Every `requires`
 *     entry below must be in the selection — asserted offline, exactly, on every push.
 *
 * **Expectations say only what the request leaves no room for.** "Summarise it" requires a model
 * call but not which kind; "decide whether it is urgent" requires a way to route but not whether
 * a Branch or a Switch does it. A case that pinned one reasonable answer would measure taste.
 *
 * **Six cases are `heldOut`.** They were written with the others, before the selector existed,
 * and were not looked at while it was tuned — so the selector's recall on them is the honest
 * estimate of how it does on a request nobody tuned it for. `BUILD_PLAN.md` → *Phase 34* records
 * both numbers.
 */

export interface EvalCase {
  /** Stable, kebab-case. A recording is keyed by it. */
  id: string;
  prompt: string;
  /** The trigger the request implies, when it implies one. */
  trigger?: "core.manual_trigger" | "core.webhook_trigger" | "core.schedule_trigger";
  /**
   * Node types the workflow must contain. A string is one type; an array is "any one of these",
   * for a need that more than one node meets.
   */
  requires?: (string | string[])[];
  /** Node types the workflow must not contain — usually the false friend of a word in the request. */
  forbids?: string[];
  /**
   * `true`: something in the request cannot be built and `unsupported` must say so. `false`: all
   * of it can, and `unsupported` must be empty. Absent: either is acceptable.
   */
  unsupported?: boolean;
  /** Not used to tune the selector. See the note above. */
  heldOut?: boolean;
}

/** The demo prompt, `scripts/demo-payload.mjs` → `DEMO_PROMPT`, kept in step with it by a test. */
export const DEMO_PROMPT = `When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.`;

export const EVAL_CASES: EvalCase[] = [
  {
    id: "demo-triage",
    prompt: DEMO_PROMPT,
    trigger: "core.webhook_trigger",
    requires: [["ai.llm", "ai.agent"], ["core.branch", "core.switch"], "integration.discord", "integration.sheets"],
    unsupported: false,
  },
  {
    id: "news-digest",
    prompt:
      "Every weekday at 8am, fetch the top stories from https://hacker-news.firebaseio.com/v0/topstories.json, summarise them and post the summary to our Slack channel.",
    trigger: "core.schedule_trigger",
    requires: ["integration.http", ["ai.llm", "ai.agent"], "integration.slack"],
    unsupported: false,
  },
  {
    id: "bug-report-issue",
    prompt:
      "When a bug report is submitted through my website form, open a GitHub issue with its title and description, then post the issue link to Discord.",
    trigger: "core.webhook_trigger",
    requires: ["integration.github", "integration.discord"],
    unsupported: false,
  },
  {
    id: "classify-billing",
    prompt:
      "When a support message arrives by webhook, classify it as billing, technical or other, and email the billing ones to finance@example.com.",
    trigger: "core.webhook_trigger",
    requires: [["ai.agent", "ai.llm"], ["core.branch", "core.switch"], "integration.gmail"],
    unsupported: false,
  },
  {
    id: "weekly-orders",
    prompt:
      "Every Monday at 9:00, count the rows in the orders table of my Postgres database and send the number to Slack.",
    trigger: "core.schedule_trigger",
    requires: ["integration.postgres", "integration.slack"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "cheap-products",
    prompt:
      "I'll paste in a list of products with prices. Keep only the ones under 50, sort them from cheapest to most expensive, and log the result.",
    trigger: "core.manual_trigger",
    requires: ["transform.filter", "transform.sort"],
    unsupported: false,
  },
  {
    id: "dedupe-addresses",
    prompt: "Remove the duplicate email addresses from the list I give it, and tell me how many are left.",
    trigger: "core.manual_trigger",
    requires: ["transform.unique"],
    // "email addresses" is data here, not a request to send mail.
    forbids: ["integration.gmail"],
    unsupported: false,
  },
  {
    id: "thank-each-customer",
    prompt:
      "For each customer in the list I give it, have AI write a short personalised thank-you note and post each note to Discord.",
    trigger: "core.manual_trigger",
    requires: ["core.loop", ["ai.llm", "ai.agent"], "integration.discord"],
    unsupported: false,
  },
  {
    id: "meeting-notes",
    prompt: "When I run it with my meeting notes, turn them into a list of action items and save them to a Notion page.",
    trigger: "core.manual_trigger",
    requires: [["ai.llm", "ai.agent"], "integration.notion"],
    unsupported: false,
  },
  {
    id: "lead-to-airtable",
    prompt:
      "When a lead fills in the contact form on my site, add them to my Airtable base and let the sales team know in Slack.",
    trigger: "core.webhook_trigger",
    requires: ["integration.airtable", "integration.slack"],
    unsupported: false,
  },
  {
    id: "welcome-later",
    prompt: "When someone signs up through my webhook, wait two days and then send them a welcome email.",
    trigger: "core.webhook_trigger",
    requires: ["core.delay", "integration.gmail"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "ssh-restart",
    prompt: "SSH into my production server and restart nginx.",
    unsupported: true,
  },
  {
    id: "uptime-sms",
    prompt: "Every five minutes, check whether https://example.com is up, and send me a text message on my phone if it is down.",
    trigger: "core.schedule_trigger",
    requires: ["integration.http"],
    // No node sends an SMS.
    unsupported: true,
  },
  {
    id: "greeting",
    prompt: "Take the name I give it, make it uppercase, put 'Hello, ' in front of it and log the greeting.",
    trigger: "core.manual_trigger",
    requires: [["transform.text", "core.set"], "core.log"],
    unsupported: false,
  },
  {
    id: "order-tax",
    // No trigger expected: the request does not say how a total arrives. (It said manual until the
    // first baseline showed this as an expectation of taste — see `BUILD_PLAN.md` → Phase 34.)
    prompt: "Given an order total, add 18% tax and round the result to two decimal places.",
    requires: ["transform.number"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "morning-date",
    prompt: "Every morning at 7, log today's date and which day of the week it is.",
    trigger: "core.schedule_trigger",
    requires: ["transform.date", "core.log"],
    unsupported: false,
  },
  {
    id: "parse-payload",
    prompt:
      "A webhook sends me a JSON string in its payload field. Parse it and post the status field from inside it to Slack.",
    trigger: "core.webhook_trigger",
    requires: ["transform.json", "integration.slack"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "invoice-total",
    prompt: "Add up the amount of every invoice in the list I provide and email the total to accounts@example.com.",
    trigger: "core.manual_trigger",
    requires: ["transform.aggregate", "integration.gmail"],
    unsupported: false,
  },
  {
    id: "refund-decision",
    // No trigger expected: a refund request could be run by hand or arrive by webhook, and the
    // request says neither. The first baseline failed a webhook here, which was the case's fault.
    prompt:
      "Have an AI agent decide whether a customer's refund request should be approved, rejected or escalated, and log the decision with the reason.",
    requires: ["ai.agent", "core.log"],
    unsupported: false,
  },
  {
    id: "route-tickets",
    prompt:
      "When a ticket comes in by webhook, route it by its category field: billing tickets go to Slack, bug tickets become GitHub issues, and everything else is posted to Discord.",
    trigger: "core.webhook_trigger",
    requires: [["core.switch", "core.branch"], "integration.slack", "integration.github", "integration.discord"],
    unsupported: false,
  },
  {
    id: "users-to-sheet",
    prompt: "Reshape the list of users I give it down to just their name and email, and add each one as a row in my Google Sheet.",
    trigger: "core.manual_trigger",
    requires: [["transform.map", "core.loop"], "integration.sheets"],
    forbids: ["integration.gmail"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "post-to-httpbin",
    prompt: "When I run it, POST the input to https://httpbin.org/post and log the status code that comes back.",
    trigger: "core.manual_trigger",
    requires: ["integration.http", "core.log"],
    unsupported: false,
  },
  {
    id: "order-check",
    prompt:
      "When an order arrives by webhook, stop the run with an error if it has no amount; otherwise log the order.",
    trigger: "core.webhook_trigger",
    requires: [["core.assert", "core.branch"], "core.log"],
    unsupported: false,
    heldOut: true,
  },
  {
    id: "insert-into-postgres",
    prompt: "When a webhook arrives, add a received-at timestamp to the payload and insert it as a new row into my Postgres events table.",
    trigger: "core.webhook_trigger",
    // The Postgres node only reads. Writing a row is the part that cannot be built.
    unsupported: true,
  },
];
