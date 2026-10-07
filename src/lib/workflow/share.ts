import type { Workflow } from "@/db/schema";
import {
  GRAPH_VERSION,
  type NoteTone,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNote,
} from "@/lib/workflow/graph";

/**
 * **What a public share link is allowed to carry — Phase 20.**
 *
 * `GET /api/share/:token` is the product's fourth unauthenticated surface, after the
 * webhook receiver, the cron tick and the invitation preview. The other three are guarded
 * by the fact that they *do* something specific; this one hands back content, which makes
 * it the only one where the risk is what is in the response rather than what the request
 * can cause.
 *
 * So the rule is an **allowlist, and the default publishes nothing**. A denylist — "strip
 * `headers`, strip `to`" — is the obvious shape and it fails open: the day somebody adds
 * `integration.slack` with a `token` field, the denylist does not know about it and the
 * link starts publishing it. This table refuses to publish a field nobody has named, so
 * the same mistake produces a share that says too little, which somebody notices, rather
 * than one that says too much, which nobody does.
 *
 * `share.test.ts` asserts that every registered node type has an entry here, so adding a
 * node makes the test fail until its publishability is a decision somebody actually took.
 *
 * ---
 *
 * **The line the table draws is: shape and settings are published, typed-in values are
 * not.** Read the column of redactions and it is almost entirely free text — a URL, a
 * prompt, an email address, a message body, a spreadsheet id. There is no field of that
 * kind whose contents can be known to be safe, because a user may put anything in one and
 * some of them do: an API key in a query string, a bearer token in a header, a customer's
 * address in a `to`. Enums, numbers and booleans carry no such risk, and neither does the
 * *name* of a key — which is why `keys` exists and is how a shared HTTP node still shows
 * that it sends an `authorization` header without showing what is in it.
 *
 * What a reader of a shared link therefore gets is the thing worth sharing: the graph's
 * structure, which nodes it is built from, how they are wired, and how each is
 * configured in every respect that is not somebody's private content. That is what
 * `BUILD_PLAN.md` Phase 20 asks for — "a read-only public share link for a workflow
 * graph" — and it is genuinely all of it.
 */
interface SharePolicy {
  /** Config fields published verbatim. Anything absent from both lists is redacted. */
  values?: readonly string[];
  /**
   * Object-shaped config fields whose **keys** are published and whose values are not.
   * `{ authorization: "Bearer …" }` publishes as `{ authorization: null }`.
   */
  keys?: readonly string[];
}

const PUBLISHABLE: Readonly<Record<string, SharePolicy>> = {
  // Triggers. `requiredFields` and `cron` describe the workflow's *interface* — when it
  // fires and what a caller must send — which is the most useful thing on a shared graph
  // and is not content. The webhook's token is not in the config at all (D41), and the
  // share response never carries the workflow's `webhookToken` column either.
  "core.manual_trigger": {},
  "core.webhook_trigger": { values: ["requiredFields"] },
  "core.schedule_trigger": { values: ["cron"] },

  // Logic and transform. The operator is published because "is not empty" is the shape of
  // the decision; `left` and `right` are redacted because they are as often a literal the
  // author typed as a `{{ }}` reference, and the reader cannot tell which from here.
  "core.branch": { values: ["operator"] },
  "core.assert": { values: ["operator"] },
  "core.loop": { values: ["maxIterations"] },
  // `amount` and `unit` are a number and an enum. A legacy Phase 5 `ms` is redacted — the
  // closed default — which costs a reader of an old diagram one number.
  "core.delay": { values: ["amount", "unit"] },
  "core.log": { values: ["level"] },
  // `fields` is the clearest case for `keys`: the set of names a Set node produces is
  // most of what it means, and every value in it is something somebody typed.
  "core.set": { values: ["merge"], keys: ["fields"] },

  // Switch publishes nothing — Phase 23A, and it is the closed default rather than an
  // oversight. Its `cases` are an array of `{ operator, value }`, so the two halves of
  // one field have opposite answers: the operators are shape and the values are content,
  // and neither `values` nor `keys` can publish half of an array. A reader still learns
  // most of what a switch does from the graph, which shows five outputs and which of them
  // are wired to anything.
  "core.switch": {},

  // Transform nodes — Phase 23A. `field` is published throughout: it is the *name* of a
  // property, which is the same category of thing as a published header name, and it is
  // what makes a shared graph legible ("sorted by score, descending"). What is redacted
  // is every free-text field a value could have been typed into — a comparison value, a
  // separator, a search string, an inline `items` list.
  "transform.filter": { values: ["field", "operator"] },
  // `fields` here follows `core.set`'s precedent rather than the `field` rule above: the
  // output key names are the interesting half and the paths stay in.
  "transform.map": { keys: ["fields"] },
  "transform.sort": { values: ["field", "direction"] },
  "transform.unique": { values: ["field"] },
  "transform.aggregate": { values: ["operation", "field"] },
  "transform.json": { values: ["mode", "pretty"] },
  "transform.text": { values: ["operation", "start", "end"] },
  "transform.number": { values: ["operation", "precision"] },
  "transform.date": { values: ["shiftMinutes", "timeZone"] },

  // Agent nodes. The model, the temperature and the iteration cap are settings. `tools`
  // is a list of registry node types, so it is already public information and it is the
  // single most interesting field on an agent node — it is what the agent may reach.
  // `choices` are the decisions it routes between, which the graph's own edges already
  // imply. The prompts are redacted: a system prompt is the most likely place in the
  // whole product for somebody to have pasted something they should not have.
  "ai.llm": { values: ["model", "temperature", "json"] },
  "ai.agent": { values: ["model", "temperature", "maxIterations", "tools", "choices"] },

  // Integrations, where the redactions matter most.
  //
  //   http     `headers` is documented in the node's own schema as the place to put "an
  //            authorization header", so its values can never be published. The `url` goes
  //            too: a key in a query string is the oldest way to leak one
  //   discord   the channel is a stored credential rather than config, so nothing here
  //            identifies it — but `content` and `username` are both authored text
  //   sheets    `spreadsheetId` names a real document; publishing it tells a reader which
  //            file to go and try to open
  //   gmail     `to` and `cc` are other people's email addresses, which are not this
  //            workflow author's to publish. Nothing is published from this node but the
  //            fact that it sends mail
  "integration.http": { values: ["method", "timeoutMs", "failOnError"], keys: ["headers"] },
  "integration.discord": {},
  "integration.sheets": { values: ["sheet", "valueInputOption"] },
  "integration.gmail": {},

  // Phase 23B's four. The comment at the top of this file used "the day somebody adds
  // `integration.slack` with a `token` field" as its example of how a denylist fails open;
  // that day arrived, and the allowlist did its job — each of these published nothing until
  // somebody decided what it should.
  //
  //   slack      nothing. The channel is a stored credential rather than config, so the only
  //              field is `text`, which is authored content. Identical to Discord's answer
  //   notion     `operation` is the shape of the act. `titleProperty` is the *name* of a
  //              database column, which is the same category as a published header name and
  //              is what makes a shared graph legible. `target` names a real document — the
  //              `spreadsheetId` reasoning exactly — and `title` and `body` are authored text
  //   github     `operation` only. `repo` is withheld even though a repository name is often
  //              public, because it is often not: publishing it would tell a reader that a
  //              private repository exists and what it is called. `labels` is free text in an
  //              array, and `core.switch` already set the rule that an array cannot be half
  //              published
  //   airtable   `operation`, `maxRecords` and `typecast` are settings. `fields` uses `keys`
  //              on `core.set`'s precedent: the column names are the interesting half and
  //              every value in them is something somebody typed. `baseId`, `table` and
  //              `view` name a real base, so they go
  "integration.slack": {},
  "integration.notion": { values: ["operation", "titleProperty"] },
  "integration.github": { values: ["operation"] },
  "integration.airtable": {
    values: ["operation", "maxRecords", "typecast"],
    keys: ["fields"],
  },

  // Phase 23C. `operation`, `direction`, `limit` and `timeoutMs` are settings: they say this
  // node counts rather than lists, and how much it reads. Everything that names the user's data
  // is withheld, and the reasoning is `integration.sheets`' `spreadsheetId` reasoning twice
  // over — `schema`, `table`, `columns` and `orderBy` together are a map of a private database's
  // structure, which is more than "which file to go and try to open". `where` goes for
  // `core.switch`'s reason: it is an array whose objects hold a column name *and* a value
  // somebody typed, and neither `values` nor `keys` can publish half of an array.
  "integration.postgres": { values: ["operation", "direction", "limit", "timeoutMs"] },
};

/** The table itself, for the test that keeps it in step with the registry. */
export function publishableTypes(): string[] {
  return Object.keys(PUBLISHABLE);
}

export interface SharedNode {
  id: string;
  type: string;
  label?: string;
  position: { x: number; y: number };
  /** Only the fields the table publishes. Redacted object fields keep their keys. */
  config: Record<string, unknown>;
  /**
   * Names of the config fields that were withheld, in the order the node stored them.
   * Present so the public canvas can say "2 values hidden" rather than quietly showing a
   * node as though it had no configuration — a reader who cannot tell the difference
   * between "unconfigured" and "not shown to you" is being misled by omission.
   */
  redacted: string[];
  /**
   * Switched off — Phase 30. **Published**, because it is shape rather than content: whether
   * a step runs. A diagram that drew a switched-off node as live would mislead its reader
   * about what the workflow does.
   */
  disabled?: true;
}

/**
 * A sticky note on a share link — Phase 30. **Its text is withheld and counted** (D135): a
 * note is the most purely authored value in a graph, free text written for colleagues about
 * the workflow's people and data, and the line this file draws — shape is published, typed-in
 * values are not — puts it on the withheld side with nothing to weigh. Its place, size and
 * tone are kept, so a reader sees *that* the author annotated this corner, and is told it is
 * hidden rather than shown an empty note.
 */
export interface SharedNote {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  tone: NoteTone;
  /** `["text"]` when there was text to withhold, `[]` for a note that was empty. */
  redacted: string[];
}

export interface SharedWorkflow {
  name: string;
  description: string | null;
  graph: {
    version: number;
    nodes: SharedNode[];
    edges: WorkflowGraph["edges"];
    /** Present only when the graph has notes. */
    notes?: SharedNote[];
  };
  /** The version number the shared graph is, so a reader can cite what they looked at. */
  version: number;
  updatedAt: string;
}

/**
 * One node, redacted.
 *
 * An unknown node type gets `{}` — the closed default — rather than throwing. A stored
 * graph can name a type this build does not have (a node renamed in a later phase, a row
 * restored from an older version), and the honest response to "I do not know what this
 * field is" on a public endpoint is to publish none of it.
 */
export function shareNode(node: WorkflowNode): SharedNode {
  const policy = PUBLISHABLE[node.type] ?? {};
  const config = node.config ?? {};

  const published: Record<string, unknown> = {};
  const redacted: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (policy.values?.includes(key)) {
      published[key] = value;
      continue;
    }
    if (policy.keys?.includes(key)) {
      // Keys only. A non-object in a field declared object-shaped is redacted whole
      // rather than guessed at.
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        published[key] = Object.fromEntries(
          Object.keys(value as Record<string, unknown>).map((name) => [name, null]),
        );
        // Still named as redacted: the reader is seeing names and no values, and a count
        // that said otherwise would be the misleading-by-omission case above.
        if (Object.keys(value as Record<string, unknown>).length > 0) redacted.push(key);
        continue;
      }
    }
    redacted.push(key);
  }

  return {
    id: node.id,
    type: node.type,
    ...(node.label === undefined ? {} : { label: node.label }),
    position: { x: node.position.x, y: node.position.y },
    config: published,
    redacted,
    ...(node.disabled ? { disabled: true as const } : {}),
  };
}

/**
 * One note, with its text withheld. Built field by field like everything else here, so a
 * field a later phase adds to a note is withheld until somebody decides otherwise.
 */
export function shareNote(note: WorkflowNote): SharedNote {
  return {
    id: note.id,
    position: { x: note.position.x, y: note.position.y },
    size: { width: note.size.width, height: note.size.height },
    tone: note.tone,
    redacted: note.text === "" ? [] : ["text"],
  };
}

/**
 * The whole response body for a share link.
 *
 * **Built field by field from an explicit list, never by spreading the row and deleting.**
 * The workflow row carries `webhookToken`, `shareToken`, `ownerId`, `workspaceId`,
 * `scheduleNextAt` and `visibility`, and a column added to that table in a later phase
 * would arrive here too under any shape that started from the row. Nothing about a run,
 * a credential or a member of the workspace is reachable from this function at all —
 * it is handed one workflow and has nothing else to leak.
 *
 * `policy` — retry and timeout — is dropped with everything else not named: it is a
 * setting rather than content, but it is also of no interest to a reader of a diagram,
 * and the closed default is what keeps this list short enough to check by eye.
 */
export function shareWorkflow(workflow: Workflow): SharedWorkflow {
  return {
    name: workflow.name,
    description: workflow.description,
    graph: {
      version: GRAPH_VERSION,
      nodes: workflow.graph.nodes.map(shareNode),
      edges: workflow.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
      })),
      ...(workflow.graph.notes?.length ? { notes: workflow.graph.notes.map(shareNote) } : {}),
    },
    version: workflow.version,
    updatedAt: workflow.updatedAt.toISOString(),
  };
}
