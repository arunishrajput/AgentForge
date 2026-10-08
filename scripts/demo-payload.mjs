/**
 * The demo's constants, in one place, plus the one piece of logic that keeps Beat 5
 * firing at a workflow the model wrote seconds earlier.
 *
 * `smoke.mjs`, `seed-demo.mjs` and `demo-fire.mjs` all need the same prompt and the
 * same payload. They used to carry their own copies, with a comment in `smoke.mjs`
 * warning that a copy which drifts from `DEMO.md` is measuring something the demo does
 * not do. Three copies is that warning waiting to come true, so there is now one.
 *
 * ── Why `adaptPayload` exists ──────────────────────────────────────────────────
 *
 * Beat 3 generates the workflow live, and the model chooses what the webhook trigger
 * requires. The first 12 generations measured wrote `requiredFields: []` eleven times
 * and `["submission"]` once — and that once was the run that built the *backup*
 * workflow, the thing whose whole job is to work when something else did not.
 *
 * **That first sample understated it badly.** Across two later ten-walk runs it was
 * **5 of 10 and 3 of 10**, plus one `content` and one `id`. This is not a rare case;
 * it is closer to a coin flip.
 *
 * When it happens, Beat 5's fixed payload is rejected **400 — missing required
 * field(s): submission** and the demo stops dead at the webhook, two beats before its
 * payoff. That is not a risk worth carrying for a fixed JSON literal, and it cannot be
 * fixed by pre-staging harder: the graph does not exist until Beat 3 has run.
 *
 * So the payload is adapted to the graph at fire time, the same way the URL is
 * resolved at fire time rather than exported ahead of it. Two things are read:
 *
 *  - `requiredFields` on the trigger — what the receiver will *reject* the call for.
 *  - every `{{trigger.x}}` in the rest of the graph — what the nodes will actually
 *    *read*. A field that passes validation but is referenced and absent produces a
 *    successful run with an empty cell in the spreadsheet, which is Beat 8's payoff
 *    quietly turning into a blank. `DEMO.md`'s own note about generated graphs says
 *    valid is not the same as correct (D38); this is that, at the trigger.
 *
 * Any such field that the fixed payload does not already carry is filled with the
 * message text, so whatever the model decided to call it, the urgent content is in
 * there and the agent still has something to judge. Nothing is ever overwritten: the
 * literal payload wins wherever it already has a key.
 */

/** `DEMO.md` Beat 2's prompt, verbatim. */
export const DEMO_PROMPT = `When my form webhook fires, summarise the submission, decide whether it's urgent,
post urgent ones to Discord, and log every one to my Google Sheet.`;

/** `DEMO.md` Beat 5's payload, verbatim. */
export const URGENT_PAYLOAD = {
  name: "Priya",
  email: "priya@example.com",
  message: "Our production checkout has been down for 40 minutes and we are losing orders.",
};

/**
 * The seed table's "non-urgent payload, held in reserve to show the other branch if
 * asked". Same shape, opposite judgement, so the agent's decision is the only thing
 * that differs between the two.
 */
export const CALM_PAYLOAD = {
  name: "Sam",
  email: "sam@example.com",
  message:
    "Loving the product so far. If you ever add a dark theme to the reports page I would use it daily — no rush at all.",
};

const TRIGGER_REFERENCE = /\{\{\s*trigger\.([A-Za-z0-9_]+)/g;
const INPUT_REFERENCE = /\{\{\s*input\.([A-Za-z0-9_]+)/g;
const STEP_REFERENCE = /\{\{\s*steps\.([A-Za-z0-9_-]+)\.output\.([A-Za-z0-9_]+)/g;

/**
 * Every body field the graph reads, by any of the three names it goes by: `{{trigger.x}}`
 * anywhere; `{{input.x}}` in a node the trigger feeds directly, where `input` IS the body; and
 * `{{steps.<trigger>.output.x}}` anywhere. Until Phase 34 only the first was read, so a generated
 * graph that wrote either of the others met a payload without the field — an empty prompt, a
 * `null` Sheets cell — and the smoke walk failed on the graph's honest reading of the body.
 */
export function triggerFieldsUsed(graph) {
  const nodes = graph?.nodes ?? [];
  const triggerIds = new Set(nodes.filter((n) => n.type?.endsWith("_trigger")).map((n) => n.id));
  const fedByTrigger = new Set(
    (graph?.edges ?? []).filter((e) => triggerIds.has(e.source)).map((e) => e.target),
  );

  const found = new Set();
  for (const node of nodes) {
    const config = JSON.stringify(node.config ?? {});
    for (const match of config.matchAll(TRIGGER_REFERENCE)) found.add(match[1]);
    if (fedByTrigger.has(node.id)) {
      for (const match of config.matchAll(INPUT_REFERENCE)) found.add(match[1]);
    }
    for (const match of config.matchAll(STEP_REFERENCE)) {
      if (triggerIds.has(match[1])) found.add(match[2]);
    }
  }
  return [...found];
}

/** The webhook trigger's declared required fields, or `[]`. */
export function requiredFieldsOf(graph) {
  const trigger = (graph?.nodes ?? []).find((n) => n.type === "core.webhook_trigger");
  return trigger?.config?.requiredFields ?? [];
}

/**
 * Returns the payload this graph will accept and can actually read, and the list of
 * keys that had to be added. An empty `added` means the literal payload was already a
 * perfect fit — which is the common case, and worth reporting rather than hiding.
 */
export function adaptPayload(graph, payload = URGENT_PAYLOAD) {
  const wanted = new Set([...requiredFieldsOf(graph), ...triggerFieldsUsed(graph)]);
  const adapted = { ...payload };
  const added = [];

  for (const field of wanted) {
    if (field in adapted) continue;
    // The message text, because it is the part the agent judges. A field named
    // `submission`, `body`, `text` or `enquiry` all want the same thing here.
    adapted[field] = payload.message ?? "";
    added.push(field);
  }

  return { payload: adapted, added };
}
