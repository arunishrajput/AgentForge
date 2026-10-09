import type { GeneratedWorkflow } from "../schema";

/**
 * **The copilot's eval set — Phase 35.** Generation's eval set (`cases.ts`) asks whether a request
 * becomes the right workflow; this one asks whether a *change* to a workflow becomes the right
 * change — and **only** that change. An edit has a failure generation cannot have: touching what
 * it was not asked to touch. So beside what the change requires, each case names the nodes it
 * must leave exactly as they were (`keeps`: id, type, label and config), the ones it must remove,
 * and the values it must set.
 *
 * The five kinds `BUILD_PLAN.md` → *Phase 35* validates on the deployed URL are all here — add a
 * node, change a config value, remove a branch, rename, and something impossible — plus a refine,
 * which is the conversation's own shape. Recorded live and replayed offline in CI exactly as the
 * generation recordings are (`eval.test.ts`).
 */

export interface EditEvalCase {
  id: string;
  /** Which starting workflow — `STARTS`. */
  start: keyof typeof STARTS;
  instruction: string;
  /** Instructions this conversation already made, which the start already includes (a refine). */
  earlier?: string[];
  /** Node types the proposal must contain — `cases.ts`'s rule. */
  requires?: (string | string[])[];
  forbids?: string[];
  /** Node ids that must survive exactly as they were: type, label and config. */
  keeps?: string[];
  /** Node ids the change must remove. */
  removes?: string[];
  /** Node id → the label it must now carry. */
  labels?: Record<string, string>;
  /** A config value that must now contain this text (as JSON, so a list or a number works too). */
  sets?: { node: string; key: string; includes: string }[];
  unsupported?: boolean;
}

/**
 * The workflows the cases start from, in the shape a model answers in. `eval.test.ts` asserts each
 * is valid and its references resolve, so a case fails only for what the copilot did to it.
 */
export const STARTS = {
  /** The demo's shape: summarise, decide, route, and a different action on each side. */
  triage: {
    name: "Triage support messages",
    description: "Summarises each support message and alerts on the urgent ones.",
    nodes: [
      { id: "trigger", type: "core.webhook_trigger", config: {} },
      {
        id: "summarise",
        type: "ai.llm",
        label: "Summarise",
        config: { prompt: "Summarise this support message in one sentence: {{trigger.message}}" },
      },
      {
        id: "decide",
        type: "ai.agent",
        label: "Decide urgency",
        config: {
          objective: "Decide whether this support message is urgent: {{steps.summarise.output.text}}",
          choices: ["urgent", "normal"],
        },
      },
      { id: "route", type: "core.branch", config: { left: "{{input.decision}}", operator: "equals", right: "urgent" } },
      {
        id: "post_discord",
        type: "integration.discord",
        label: "Alert on Discord",
        config: { content: "Urgent: {{steps.summarise.output.text}}" },
      },
      {
        id: "log_normal",
        type: "core.log",
        label: "Log the rest",
        config: { message: "Normal: {{steps.summarise.output.text}}" },
      },
    ],
    edges: [
      { source: "trigger", target: "summarise" },
      { source: "summarise", target: "decide" },
      { source: "decide", target: "route" },
      { source: "route", target: "post_discord", sourceHandle: "true" },
      { source: "route", target: "log_normal", sourceHandle: "false" },
    ],
    unsupported: [],
  },
  /** A morning digest: fetch, summarise, post. */
  digest: {
    name: "Morning digest",
    description: "Posts a summary of the top stories every weekday morning.",
    nodes: [
      { id: "every_weekday", type: "core.schedule_trigger", config: { cron: "0 8 * * 1-5" } },
      {
        id: "fetch",
        type: "integration.http",
        label: "Fetch top stories",
        config: { method: "GET", url: "https://hacker-news.firebaseio.com/v0/topstories.json" },
      },
      {
        id: "summarise",
        type: "ai.llm",
        config: { prompt: "Summarise these top story ids for a team channel: {{steps.fetch.output.text}}" },
      },
      { id: "post", type: "integration.slack", label: "Post the digest", config: { text: "{{steps.summarise.output.text}}" } },
    ],
    edges: [
      { source: "every_weekday", target: "fetch" },
      { source: "fetch", target: "summarise" },
      { source: "summarise", target: "post" },
    ],
    unsupported: [],
  },
  /** The triage workflow after "also post the urgent ones to Slack" was accepted — a refine's start. */
  triageWithSlack: {
    name: "Triage support messages",
    description: "Summarises each support message and alerts on the urgent ones.",
    nodes: [
      { id: "trigger", type: "core.webhook_trigger", config: {} },
      {
        id: "summarise",
        type: "ai.llm",
        label: "Summarise",
        config: { prompt: "Summarise this support message in one sentence: {{trigger.message}}" },
      },
      {
        id: "decide",
        type: "ai.agent",
        label: "Decide urgency",
        config: {
          objective: "Decide whether this support message is urgent: {{steps.summarise.output.text}}",
          choices: ["urgent", "normal"],
        },
      },
      { id: "route", type: "core.branch", config: { left: "{{input.decision}}", operator: "equals", right: "urgent" } },
      {
        id: "post_discord",
        type: "integration.discord",
        label: "Alert on Discord",
        config: { content: "Urgent: {{steps.summarise.output.text}}" },
      },
      {
        id: "post_slack",
        type: "integration.slack",
        label: "Alert on Slack",
        config: { text: "Urgent: {{steps.summarise.output.text}}" },
      },
      {
        id: "log_normal",
        type: "core.log",
        label: "Log the rest",
        config: { message: "Normal: {{steps.summarise.output.text}}" },
      },
    ],
    edges: [
      { source: "trigger", target: "summarise" },
      { source: "summarise", target: "decide" },
      { source: "decide", target: "route" },
      { source: "route", target: "post_discord", sourceHandle: "true" },
      { source: "route", target: "post_slack", sourceHandle: "true" },
      { source: "route", target: "log_normal", sourceHandle: "false" },
    ],
    unsupported: [],
  },
} satisfies Record<string, GeneratedWorkflow>;

const TRIAGE_ALL = ["trigger", "summarise", "decide", "route", "post_discord", "log_normal"];

export const EDIT_CASES: EditEvalCase[] = [
  {
    id: "add-slack",
    start: "triage",
    instruction: "Also post the urgent ones to Slack.",
    requires: ["integration.slack"],
    keeps: TRIAGE_ALL,
    unsupported: false,
  },
  {
    id: "change-message",
    start: "triage",
    instruction: "Make the Discord alert start with URGENT in capitals.",
    keeps: ["trigger", "summarise", "decide", "route", "log_normal"],
    sets: [{ node: "post_discord", key: "content", includes: "URGENT" }],
    unsupported: false,
  },
  {
    id: "change-schedule",
    start: "digest",
    instruction: "Run it at 7am instead of 8am.",
    keeps: ["fetch", "summarise", "post"],
    sets: [{ node: "every_weekday", key: "cron", includes: "0 7 " }],
    unsupported: false,
  },
  {
    id: "remove-branch",
    start: "triage",
    instruction: "Remove the branch for normal messages — don't log the ones that aren't urgent.",
    removes: ["log_normal"],
    keeps: ["trigger", "summarise", "decide", "route", "post_discord"],
  },
  {
    id: "rename-step",
    start: "triage",
    instruction: "Rename the Summarise step to 'Summarise the message'.",
    labels: { summarise: "Summarise the message" },
    keeps: ["trigger", "decide", "route", "post_discord", "log_normal"],
    unsupported: false,
  },
  {
    id: "rename-workflow",
    start: "digest",
    instruction: "Rename this workflow to 'Daily news'.",
    keeps: ["every_weekday", "fetch", "summarise", "post"],
    unsupported: true,
  },
  {
    id: "impossible-ssh",
    start: "triage",
    instruction: "When it's urgent, also SSH into the support server and restart it.",
    keeps: TRIAGE_ALL,
    unsupported: true,
  },
  {
    id: "agent-tool",
    start: "triage",
    instruction: "Let the urgency agent check our status page at https://status.example.com over HTTP before it decides.",
    keeps: ["trigger", "summarise", "route", "post_discord", "log_normal"],
    sets: [{ node: "decide", key: "tools", includes: "integration.http" }],
  },
  {
    id: "refine-only-slack",
    start: "triageWithSlack",
    earlier: ["Also post the urgent ones to Slack."],
    instruction: "No — only post them to Slack, not Discord.",
    requires: ["integration.slack"],
    forbids: ["integration.discord"],
    removes: ["post_discord"],
    keeps: ["trigger", "summarise", "decide", "route", "post_slack", "log_normal"],
  },
];
