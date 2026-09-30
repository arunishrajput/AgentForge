import { GRAPH_VERSION, type WorkflowGraph } from "@/lib/workflow/graph";

/**
 * The template gallery — Phase 23A.
 *
 * **Templates are graph literals in the repository, not rows in a table.** That is the
 * decision this file rests on and it buys three things:
 *
 *  - **They cannot rot undetected.** `templates.test.ts` validates every graph against
 *    the real registry and *executes* the ones that reach no service. A node renamed in
 *    a later phase fails the build here, at the same moment it breaks the template —
 *    not months later when a user clicks one.
 *  - **They cost nothing.** No table, no seed migration, no rows multiplied per
 *    workspace, and nothing for a new deployment to bootstrap. The zero-cost ceiling
 *    holds by construction (`CLAUDE.md` → *Cost rules*).
 *  - **Using one is an ordinary workflow creation.** `POST /api/templates/:id` builds
 *    the body and calls `createWorkflow`, so a cloned template gets its version 1, its
 *    webhook token and its workspace scoping from exactly the same path as every other
 *    workflow. There is no second way for a workflow to come into existence.
 *
 * **Positions are hand-placed**, in a left-to-right chain at a 240 px pitch, because a
 * template that opens as a readable graph is most of what a template is for. A cloned
 * graph is a normal graph and the user may move anything.
 */

/** Horizontal pitch and the lane a straight chain sits on. */
const STEP = 240;
const LANE = 160;

const at = (column: number, row = 0) => ({ x: 80 + column * STEP, y: LANE + row * 130 });

export interface WorkflowTemplate {
  /** Stable slug. It is in the URL and in the clone request — renaming one breaks a link. */
  id: string;
  name: string;
  /** One sentence, for the gallery card. */
  description: string;
  /** What a reader learns from opening it. Shown on the card's back, so to speak. */
  about: string;
  /**
   * What must exist before it will run. **Empty means it runs the moment it is cloned**,
   * and that is the property the test relies on to execute it — a template that needs a
   * credential cannot be proven by running it here, so the two sets are kept distinct
   * rather than blurred.
   */
  requires: string[];
  graph: WorkflowGraph;
  /** Trigger payload that makes it do something meaningful. Used by the test and the UI. */
  sampleInput?: Record<string, unknown>;
}

type NodeSpec = {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
  at: { x: number; y: number };
};

type EdgeSpec = { from: string; to: string; handle?: string };

function build(nodes: NodeSpec[], edges: EdgeSpec[]): WorkflowGraph {
  return {
    version: GRAPH_VERSION,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      ...(node.label ? { label: node.label } : {}),
      position: node.at,
      config: node.config ?? {},
    })),
    edges: edges.map((edge, index) => ({
      id: `e${index + 1}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.handle ?? null,
    })),
  };
}

/**
 * Rank a list and say what came top.
 *
 * The one that exists to show that the transform nodes **chain without glue**: filter,
 * sort and summarise each read `items` off the previous node's output, so there is no
 * `core.set` between them re-shaping anything. That is why every list node returns
 * `{ items, count }` rather than a bare array.
 */
const rankAndReport: WorkflowTemplate = {
  id: "rank-and-report",
  name: "Rank a list and report the top",
  description: "Filters a list, sorts what is left, and writes a one-line summary of the winners.",
  about:
    "The shape almost every reporting workflow has: narrow the data, order it, reduce it to a sentence. The three transform nodes chain directly — each one reads the list the previous one produced, with nothing in between.",
  requires: [],
  graph: build(
    [
      { id: "start", type: "core.manual_trigger", at: at(0) },
      {
        id: "data",
        type: "core.set",
        label: "Sample data",
        // Named `items` on purpose: every list node looks for that key on its input,
        // so naming it anything else is what would force a reshape node in between.
        config: {
          fields: {
            items: [
              { name: "Ada", score: 92 },
              { name: "Grace", score: 78 },
              { name: "Alan", score: 41 },
              { name: "Katherine", score: 95 },
              { name: "Edsger", score: 55 },
            ],
          },
        },
        at: at(1),
      },
      {
        id: "passing",
        type: "transform.filter",
        label: "Score over 50",
        config: { field: "score", operator: "greater_than", value: 50 },
        at: at(2),
      },
      {
        id: "ranked",
        type: "transform.sort",
        label: "Best first",
        config: { field: "score", direction: "desc" },
        at: at(3),
      },
      {
        id: "names",
        type: "transform.aggregate",
        label: "Join the names",
        config: { operation: "join", field: "name", separator: ", " },
        at: at(4),
      },
      {
        id: "report",
        type: "core.log",
        label: "The summary",
        config: {
          message:
            "{{steps.passing.output.count}} of {{steps.passing.output.total}} scored over 50: {{steps.names.output.value}}",
        },
        at: at(5),
      },
    ],
    [
      { from: "start", to: "data" },
      { from: "data", to: "passing" },
      { from: "passing", to: "ranked" },
      { from: "ranked", to: "names" },
      { from: "names", to: "report" },
    ],
  ),
};

/**
 * Turn one messy string into a clean list.
 *
 * The text-wrangling most integrations need before anything else can happen: one field
 * arrives comma-separated, and three nodes later it is a sorted list with the repeats
 * gone and a count to report.
 */
const tidyList: WorkflowTemplate = {
  id: "tidy-list",
  name: "Split and tidy a list",
  description: "Splits a comma-separated field into a list, removes duplicates, sorts it and counts it.",
  about:
    "What to reach for when a single field arrives holding several values. Note the order: the case is folded before the split, because \"Urgent\" and \"urgent\" are different strings and de-duplicating first would keep both.",
  requires: [],
  sampleInput: { tags: "billing, urgent, billing, refund, Urgent, refund" },
  graph: build(
    [
      {
        id: "start",
        type: "core.manual_trigger",
        at: at(0),
      },
      {
        // Case-folding BEFORE the split, not after, and this is the whole lesson of the
        // template: "Urgent" and "urgent" are different strings, so de-duplicating
        // without this step quietly keeps both and the count is wrong in a way that
        // looks right. Splitting on ", " rather than "," matters for the same reason —
        // " billing" is not "billing".
        id: "lower",
        type: "transform.text",
        label: "Fold the case",
        config: { text: "{{input.tags}}", operation: "lowercase" },
        at: at(1),
      },
      {
        id: "pieces",
        type: "transform.text",
        label: "Split on commas",
        config: { text: "{{steps.lower.output.text}}", operation: "split", search: ", " },
        at: at(2),
      },
      {
        id: "deduped",
        type: "transform.unique",
        label: "Remove repeats",
        at: at(3),
      },
      {
        id: "ordered",
        type: "transform.sort",
        label: "Alphabetical",
        at: at(4),
      },
      {
        id: "total",
        type: "transform.aggregate",
        label: "Count them",
        config: { operation: "count" },
        at: at(5),
      },
      {
        id: "report",
        type: "core.log",
        config: {
          message: "{{steps.total.output.value}} distinct tag(s): {{steps.ordered.output.items}}",
        },
        at: at(6),
      },
    ],
    [
      { from: "start", to: "lower" },
      { from: "lower", to: "pieces" },
      { from: "pieces", to: "deduped" },
      { from: "deduped", to: "ordered" },
      { from: "ordered", to: "total" },
      { from: "total", to: "report" },
    ],
  ),
};

/**
 * Route an incoming webhook by priority.
 *
 * The template that shows the *shape* of a real integration: something posts JSON, the
 * workflow decides what kind of thing it is, and different work happens per kind. The
 * three destinations are logs so that it runs for anybody the moment it is cloned —
 * replacing one with a Discord node is the obvious next edit, and the `about` says so.
 */
const triageWebhook: WorkflowTemplate = {
  id: "triage-webhook",
  name: "Triage an incoming webhook",
  description: "Accepts a JSON POST and routes it three ways on its priority field.",
  about:
    "Save it, copy the webhook URL from the trigger, and POST to it. The Switch node picks the path; swap any of the three logs for a Discord or Gmail node to make something happen.",
  requires: [],
  sampleInput: { priority: "urgent", message: "The checkout page is down" },
  graph: build(
    [
      {
        id: "start",
        type: "core.webhook_trigger",
        label: "Incoming POST",
        config: { requiredFields: ["priority", "message"] },
        at: at(0),
      },
      {
        id: "route",
        type: "core.switch",
        label: "How urgent?",
        config: {
          value: "{{input.priority}}",
          cases: [
            { operator: "equals", value: "urgent" },
            { operator: "equals", value: "high" },
          ],
        },
        at: at(1),
      },
      {
        id: "page",
        type: "core.log",
        label: "Page someone",
        config: { message: "URGENT: {{input.value}} — {{trigger.message}}", level: "error" },
        at: at(2, -1),
      },
      {
        id: "queue",
        type: "core.log",
        label: "Into the queue",
        config: { message: "High priority: {{trigger.message}}", level: "warn" },
        at: at(2, 0),
      },
      {
        id: "file",
        type: "core.log",
        label: "Just file it",
        config: { message: "Filed: {{trigger.message}}", level: "info" },
        at: at(2, 1),
      },
    ],
    [
      { from: "start", to: "route" },
      { from: "route", to: "page", handle: "1" },
      { from: "route", to: "queue", handle: "2" },
      { from: "route", to: "file", handle: "else" },
    ],
  ),
};

/**
 * A scheduled digest.
 *
 * Exists mostly to put `transform.date` and a cron trigger in front of somebody, because
 * the time-zone question is the one that bites: this runs on a server whose clock is
 * UTC, and the date node says which zone it formatted in rather than leaving it implied.
 */
const dailyDigest: WorkflowTemplate = {
  id: "daily-digest",
  name: "A daily digest, on a schedule",
  description: "Runs every morning, works out today's date in your own time zone, and writes a headline.",
  about:
    "The starting point for anything recurring. Change the cron on the trigger and the time zone on the date node, then add the nodes that gather what you actually want to report.",
  requires: [],
  graph: build(
    [
      {
        id: "start",
        type: "core.schedule_trigger",
        label: "Every day at 09:00 UTC",
        config: { cron: "0 9 * * *" },
        at: at(0),
      },
      {
        id: "today",
        type: "transform.date",
        label: "Today, in London",
        config: { timeZone: "Europe/London" },
        at: at(1),
      },
      {
        id: "headline",
        type: "core.set",
        label: "Build the headline",
        config: {
          fields: {
            title: "Digest for {{steps.today.output.weekday}} {{steps.today.output.date}}",
            generatedAt: "{{steps.today.output.iso}}",
          },
        },
        at: at(2),
      },
      {
        id: "report",
        type: "core.log",
        config: { message: "{{steps.headline.output.title}}" },
        at: at(3),
      },
    ],
    [
      { from: "start", to: "today" },
      { from: "today", to: "headline" },
      { from: "headline", to: "report" },
    ],
  ),
};

/**
 * Ask a model to classify something, then act on the answer.
 *
 * **The one that shows what this product is actually for**, and the only template whose
 * `requires` is non-empty: it needs a Gemini key in Settings. The model is asked for
 * JSON so that the switch downstream routes on a *field* rather than on prose — the D38
 * failure in miniature, and the reason `transform.json` sits between them.
 */
const classifyAndRoute: WorkflowTemplate = {
  id: "classify-and-route",
  name: "Classify text with a model, then route it",
  description: "Sends text to a model, asks for a structured verdict, and branches on what comes back.",
  about:
    "Reasoning and routing in one graph: the model decides the category, and ordinary workflow nodes act on it. Asking for JSON rather than prose is what makes the Switch below it reliable.",
  requires: ["A Gemini API key in Settings"],
  sampleInput: { message: "I was charged twice for my subscription this month." },
  graph: build(
    [
      { id: "start", type: "core.manual_trigger", at: at(0) },
      {
        id: "classify",
        type: "ai.llm",
        label: "Classify it",
        config: {
          system:
            'You classify customer messages. Answer ONLY with JSON of the form {"category":"billing"|"bug"|"other","reason":"one short sentence"}.',
          prompt: "Classify this message:\n\n{{input.message}}",
          json: true,
        },
        at: at(1),
      },
      {
        id: "route",
        type: "core.switch",
        label: "Which desk?",
        config: {
          value: "{{steps.classify.output.json.category}}",
          cases: [
            { operator: "equals", value: "billing" },
            { operator: "equals", value: "bug" },
          ],
        },
        at: at(2),
      },
      {
        id: "billing",
        type: "core.log",
        label: "Billing",
        config: { message: "Billing: {{steps.classify.output.json.reason}}" },
        at: at(3, -1),
      },
      {
        id: "bug",
        type: "core.log",
        label: "Engineering",
        config: { message: "Bug: {{steps.classify.output.json.reason}}", level: "warn" },
        at: at(3, 0),
      },
      {
        id: "other",
        type: "core.log",
        label: "General",
        config: { message: "Other: {{steps.classify.output.json.reason}}" },
        at: at(3, 1),
      },
    ],
    [
      { from: "start", to: "classify" },
      { from: "classify", to: "route" },
      { from: "route", to: "billing", handle: "1" },
      { from: "route", to: "bug", handle: "2" },
      { from: "route", to: "other", handle: "else" },
    ],
  ),
};

/**
 * Fetch JSON from a public API and reduce it to a sentence.
 *
 * Reaches the network, so the test validates it without running it. The URL is a public,
 * keyless endpoint chosen so that cloning it and pressing Run works with nothing
 * configured — `integration.http` is still bounded by `guard.ts` either way.
 */
const fetchAndSummarise: WorkflowTemplate = {
  id: "fetch-and-summarise",
  name: "Fetch from an API and summarise it",
  description: "Calls a public JSON endpoint, keeps the fields you want, and counts what came back.",
  about:
    "The integration starting point. Point the HTTP node at any JSON API, use Reshape list to flatten the response into the columns you care about, and the rest of the graph stays the same.",
  requires: [],
  graph: build(
    [
      { id: "start", type: "core.manual_trigger", at: at(0) },
      {
        id: "fetch",
        type: "integration.http",
        label: "Call the API",
        config: { method: "GET", url: "https://jsonplaceholder.typicode.com/users" },
        at: at(1),
      },
      {
        id: "people",
        type: "transform.map",
        label: "Keep three fields",
        config: {
          items: "{{steps.fetch.output.json}}",
          fields: { name: "name", city: "address.city", company: "company.name" },
        },
        at: at(2),
      },
      {
        id: "ordered",
        type: "transform.sort",
        label: "By name",
        config: { field: "name" },
        at: at(3),
      },
      {
        id: "total",
        type: "transform.aggregate",
        config: { operation: "count" },
        at: at(4),
      },
      {
        id: "report",
        type: "core.log",
        config: { message: "Fetched {{steps.total.output.value}} people." },
        at: at(5),
      },
    ],
    [
      { from: "start", to: "fetch" },
      { from: "fetch", to: "people" },
      { from: "people", to: "ordered" },
      { from: "ordered", to: "total" },
      { from: "total", to: "report" },
    ],
  ),
};

/**
 * Phase 23B's four, one per service.
 *
 * Every one of them has a non-empty `requires`, which is what keeps them out of the set
 * `templates.test.ts` executes — `reachesNoService()` reads that off the node types rather
 * than off `requires`, so a template using an integration node cannot accidentally be run by
 * the suite against somebody's real Slack channel. They are still validated against the real
 * registry, which is the half that catches a rename.
 *
 * **Each one is deliberately short.** A template is read before it is run, and a five-node
 * graph that obviously does one useful thing teaches more than a fifteen-node graph nobody
 * finishes reading. The `about` says what to change first.
 */

const slackStandup: WorkflowTemplate = {
  id: "slack-standup",
  name: "A daily nudge in Slack",
  description: "Every morning, works out the date in your time zone and posts a standup prompt to Slack.",
  about:
    "The shortest useful scheduled workflow. Change the cron on the trigger, the time zone on the date node and the words in the Slack node — the channel comes from the webhook you connected in Settings, so there is nothing to address.",
  requires: ["A Slack incoming webhook in Settings → Integrations"],
  graph: build(
    [
      {
        id: "start",
        type: "core.schedule_trigger",
        label: "Weekday mornings",
        config: { cron: "0 9 * * 1-5" },
        at: at(0),
      },
      {
        id: "today",
        type: "transform.date",
        label: "Today, in London",
        config: { timeZone: "Europe/London" },
        at: at(1),
      },
      {
        id: "post",
        type: "integration.slack",
        label: "Ask the team",
        config: {
          text: "Standup for {{steps.today.output.weekday}} {{steps.today.output.date}} — what are you on today?",
        },
        at: at(2),
      },
    ],
    [
      { from: "start", to: "today" },
      { from: "today", to: "post" },
    ],
  ),
};

const webhookToGithub: WorkflowTemplate = {
  id: "webhook-to-github",
  name: "Turn a webhook into a GitHub issue",
  description: "Accepts a JSON POST, files it as an issue, and says in Slack that it did.",
  about:
    "A bug-report funnel. POST { title, detail } to the trigger's webhook URL and it becomes an issue in the repository you name on the GitHub node, then a Slack message carrying the issue's link. Set repo to owner/name — the stored token has to have been granted that repository.",
  requires: [
    "A GitHub token in Settings → Integrations",
    "A Slack incoming webhook, for the confirmation step",
  ],
  sampleInput: { title: "Checkout fails on Safari", detail: "The pay button does nothing." },
  graph: build(
    [
      {
        id: "start",
        type: "core.webhook_trigger",
        label: "Incoming report",
        config: { requiredFields: ["title", "detail"] },
        at: at(0),
      },
      {
        id: "file",
        type: "integration.github",
        label: "File it",
        config: {
          operation: "createIssue",
          repo: "",
          title: "{{trigger.title}}",
          body: "Reported through AgentForge.\n\n{{trigger.detail}}",
          labels: ["triage"],
        },
        at: at(1),
      },
      {
        id: "announce",
        type: "integration.slack",
        label: "Say so",
        config: { text: "Filed {{steps.file.output.repo}}#{{steps.file.output.number}}: {{steps.file.output.url}}" },
        at: at(2),
      },
    ],
    [
      { from: "start", to: "file" },
      { from: "file", to: "announce" },
    ],
  ),
};

const airtableInbox: WorkflowTemplate = {
  id: "airtable-inbox",
  name: "Collect signups in Airtable",
  description: "Takes a JSON POST and writes it as a row in an Airtable base.",
  about:
    "A form backend without a backend. Point a form or a service at the trigger's webhook URL, then set baseId and table on the Airtable node and make the field names match your columns exactly — capitals included, which is the one thing Airtable is strict about.",
  requires: ["An Airtable token in Settings → Integrations, with data.records:write"],
  sampleInput: { name: "Ada Lovelace", email: "ada@example.com" },
  graph: build(
    [
      {
        id: "start",
        type: "core.webhook_trigger",
        label: "Incoming signup",
        config: { requiredFields: ["name", "email"] },
        at: at(0),
      },
      {
        id: "row",
        type: "integration.airtable",
        label: "Add the row",
        config: {
          operation: "createRecord",
          baseId: "",
          table: "",
          fields: { Name: "{{trigger.name}}", Email: "{{trigger.email}}" },
        },
        at: at(1),
      },
      {
        id: "confirm",
        type: "core.log",
        label: "Note it",
        config: { message: "Stored {{steps.row.output.recordId}} for {{trigger.email}}." },
        at: at(2),
      },
    ],
    [
      { from: "start", to: "row" },
      { from: "row", to: "confirm" },
    ],
  ),
};

const notionRunLog: WorkflowTemplate = {
  id: "notion-run-log",
  name: "Keep a run log in Notion",
  description: "Appends a dated line to a Notion page every time it runs.",
  about:
    "Turns a Notion page into an append-only journal. Paste the page's link into the Notion node — and connect that page to your integration in Notion itself (“…” → Connections), or every run reports a 404 about a page that plainly exists.",
  requires: ["A Notion integration in Settings → Integrations, connected to the target page"],
  graph: build(
    [
      { id: "start", type: "core.manual_trigger", label: "Run it", at: at(0) },
      {
        id: "today",
        type: "transform.date",
        label: "Timestamp it",
        config: { timeZone: "UTC" },
        at: at(1),
      },
      {
        id: "write",
        type: "integration.notion",
        label: "Append the line",
        config: {
          operation: "appendToPage",
          target: "",
          body: "{{steps.today.output.iso}} — the workflow ran.",
        },
        at: at(2),
      },
    ],
    [
      { from: "start", to: "today" },
      { from: "today", to: "write" },
    ],
  ),
};

/** Gallery order: the two that run instantly first, then shape, then the ambitious ones. */
export const TEMPLATES: readonly WorkflowTemplate[] = [
  rankAndReport,
  tidyList,
  triageWebhook,
  dailyDigest,
  classifyAndRoute,
  fetchAndSummarise,
  // Phase 23B. Last, because each needs a credential before it does anything — the gallery
  // shows `requires` on the card, so the ones that run the moment they are cloned come first.
  slackStandup,
  notionRunLog,
  webhookToGithub,
  airtableInbox,
];

/**
 * Whether a template reaches anything outside the run.
 *
 * **Derived from the graph rather than declared**, because a declared flag is a second
 * thing to keep in step and this one can be read off the node types directly: the `ai.`
 * and `integration.` namespaces are exactly the nodes that leave the process. A template
 * that reaches nothing is one `templates.test.ts` can *execute*, which is the difference
 * between a template that is checked and a template that is merely well-formed.
 *
 * Distinct from `requires`, and deliberately: `fetch-and-summarise` requires no setup at
 * all — clone it and press Run — yet it calls a public API, so the test may not run it.
 */
export function reachesNoService(template: WorkflowTemplate): boolean {
  return template.graph.nodes.every(
    (node) => !node.type.startsWith("integration.") && !node.type.startsWith("ai."),
  );
}

export function getTemplate(id: string): WorkflowTemplate | undefined {
  return TEMPLATES.find((template) => template.id === id);
}

/** What the gallery card needs. Excludes the graph, which is large and unread there. */
export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  about: string;
  requires: string[];
  nodeCount: number;
  /** Distinct node types, in graph order — the card's chips. */
  uses: string[];
}

export function describeTemplate(template: WorkflowTemplate): TemplateSummary {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    about: template.about,
    requires: template.requires,
    nodeCount: template.graph.nodes.length,
    uses: [...new Set(template.graph.nodes.map((node) => node.type))],
  };
}

export function describeTemplates(): TemplateSummary[] {
  return TEMPLATES.map(describeTemplate);
}
