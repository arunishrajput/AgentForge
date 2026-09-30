import { accessToken, projectId } from "@/lib/gcp/metadata";

/**
 * The queue — Cloud Tasks, reached over its REST API with `fetch`.
 *
 * **No client library, deliberately.** `@google-cloud/tasks` pulls in gRPC and its
 * generated protobufs; the runtime dependency list has been the Phase 4 one since
 * Phase 4 (`PROGRESS.md` → *Installed stack*) and this is not the phase to break that
 * for one `POST`. Creating a task is a single authenticated HTTP request, and the
 * credential is already on the instance: Cloud Run's metadata server mints an access
 * token for the service account with no key material anywhere. **Phase 21 moved that half
 * into `lib/gcp/metadata.ts`**, because Secret Manager needs the same token and two caches on
 * one instance are two things that can disagree about when it expired.
 *
 * **What travels in a task: a run id and its dispatch token. Nothing else.** Cloud
 * Tasks bills per 32 KB chunk of task payload (`DEPLOYMENT.md` → *Cloud Tasks*), so a
 * task carrying a graph and a trigger payload would cost three operations where this
 * costs one — and the graph is already in Postgres, so putting it in the task would be
 * duplicating state as well as paying for it.
 *
 * **Not configured is a supported state, not an error.** There is no metadata server on
 * a developer machine and no queue in CI. `enqueueRun` says so rather than throwing,
 * and the caller falls back to running in-process — still leased, still checkpointed,
 * still resumable, just not redeliverable. The one hazard is that the *deployed*
 * service could silently do the same, which would make this whole phase a no-op that
 * nothing reports; `/api/health` therefore states the queue's configuration, and the
 * deployed verification asserts it.
 */

const TASKS_API = "https://cloudtasks.googleapis.com/v2";

/** How long the worker is given to answer a delivery. Above the engine's 120 s. */
export const DISPATCH_DEADLINE_SECONDS = 300;

/** Bounds every call to Google's APIs so a slow queue cannot hold a user's request. */
const TASKS_TIMEOUT_MS = 10_000;

export interface QueueConfig {
  project: string;
  location: string;
  queue: string;
}

/**
 * Where the queue is, or why we do not know.
 *
 * `TASKS_LOCATION` defaults to the Cloud Run region, because a queue in another region
 * would be a deliberate act and there is no reason to make the common case say it
 * twice. The project comes from the metadata server so it is never wrong in a way a
 * copied environment variable can be.
 */
export async function queueConfig(): Promise<QueueConfig | null> {
  const queue = process.env.TASKS_QUEUE;
  if (!queue) return null;

  const project = process.env.TASKS_PROJECT ?? (await projectId());
  const location = process.env.TASKS_LOCATION ?? process.env.GCP_REGION;
  if (!project || !location) return null;

  return { project, location, queue };
}

/**
 * The task body Cloud Tasks is asked to create.
 *
 * Pulled out of `enqueueRun` so it can be asserted without a network: everything that
 * can quietly be wrong about a task is in here — the base64 the REST API requires
 * rather than a raw body, a `baseUrl` that may or may not end in a slash, and the
 * secret going in a header rather than the body. A mistake in any of those produces a
 * task that is created successfully and can never be delivered, which is the worst
 * shape of bug to find in production.
 */
export function buildTask(options: {
  runId: string;
  token: string;
  baseUrl: string;
  secret: string;
}) {
  const body = JSON.stringify({ runId: options.runId, token: options.token });

  // Deliberately unnamed. A task named after its run would give Cloud Tasks' own
  // deduplication for free, but it also makes the name unusable for about an hour
  // afterwards and carries a documented throughput cost — and the lease already makes a
  // duplicate delivery harmless, which is the property that actually matters.
  return {
    httpRequest: {
      httpMethod: "POST" as const,
      url: `${options.baseUrl.replace(/\/+$/, "")}/api/runs/dispatch`,
      headers: { "content-type": "application/json", "x-cron-secret": options.secret },
      body: Buffer.from(body, "utf8").toString("base64"),
    },
    dispatchDeadline: `${DISPATCH_DEADLINE_SECONDS}s`,
  };
}

export type EnqueueResult =
  | { enqueued: true; task: string }
  | { enqueued: false; reason: "unconfigured" | "unauthenticated" | "rejected"; detail?: string };

/**
 * Put a run on the queue. The task's target is this same service's dispatch endpoint,
 * authenticated the way every machine endpoint here is (`CONTRACT.md` → *Trigger
 * shapes*): the shared `CRON_SECRET` as the outer gate, and the run's own dispatch
 * token as the thing that actually authorises the work.
 *
 * The URL is built from `APP_BASE_URL` and never from a request, because in this
 * container `request.url` is the bind address — `0.0.0.0:8080` — which is the general
 * lesson D53 left behind and would here produce a task that can never be delivered.
 */
export async function enqueueRun(options: {
  runId: string;
  token: string;
  baseUrl: string;
  secret: string;
}): Promise<EnqueueResult> {
  const config = await queueConfig();
  if (!config) return { enqueued: false, reason: "unconfigured" };

  const token = await accessToken();
  if (!token) return { enqueued: false, reason: "unauthenticated" };

  const parent = `projects/${config.project}/locations/${config.location}/queues/${config.queue}`;
  const task = buildTask(options);

  let response: Response;
  try {
    response = await fetch(`${TASKS_API}/${parent}/tasks`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ task }),
      signal: AbortSignal.timeout(TASKS_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      enqueued: false,
      reason: "rejected",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  if (!response.ok) {
    // The body carries Google's own message, which is the useful half of a 403 telling
    // you the service account lacks `cloudtasks.enqueuer`.
    const detail = await response.text().catch(() => "");
    return {
      enqueued: false,
      reason: "rejected",
      detail: `${response.status} ${detail.slice(0, 500)}`,
    };
  }

  const created = (await response.json().catch(() => ({}))) as { name?: string };
  return { enqueued: true, task: created.name ?? "(unnamed)" };
}

/**
 * What a delivery says about itself. Cloud Tasks sets these headers on every push, and
 * they are the only way to tell a first delivery from a fourth retry inside the
 * handler — worth logging, because "this run resumed" and "this run resumed for the
 * third time" are different stories.
 */
export function describeDelivery(headers: Headers): {
  queue: string | null;
  taskName: string | null;
  retryCount: number | null;
} {
  const count = headers.get("x-cloudtasks-taskretrycount");
  return {
    queue: headers.get("x-cloudtasks-queuename"),
    taskName: headers.get("x-cloudtasks-taskname"),
    retryCount: count === null ? null : Number.parseInt(count, 10),
  };
}
