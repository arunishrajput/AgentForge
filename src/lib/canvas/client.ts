import type { ProviderSettings, ProviderState } from "@/lib/ai/settings";
import type { GenerationAttempt, GenerationIssue } from "@/lib/generate/generate";
import type { ModelInfo } from "@/lib/ai/types";
/**
 * **From `api-error`, not from `api` — and `recoveryOf` is why the split exists.** It is a
 * *value*, so importing it through `@/lib/api` would drag `@/auth` and `next-auth` into
 * every client bundle that touches this module. The type-only imports above are erased and
 * can come from anywhere; this one cannot.
 */
import { recoveryOf, type ApiErrorCode, type Recovery } from "@/lib/api-error";
import type { RekeyOutcome } from "@/lib/credentials/rekey";
import type { Vault, VaultEntry } from "@/lib/credentials/vault";
import type { StreamRun } from "@/lib/engine/stream";
import type { RunSummary, StepBodies, StepHeader } from "@/lib/runs/history";
import type { GraphProblem } from "@/lib/engine/validate";
import type {
  DiscordStatus,
  GoogleStatus,
  TokenIntegrationStatus,
} from "@/lib/integrations/store";
import type { NodeSummary } from "@/lib/nodes";
import type { GraphDiff } from "@/lib/workflow/diff";
import type { SharedWorkflow } from "@/lib/workflow/share";
import type { WorkflowVisibility } from "@/lib/workflow/visibility";
import type { InvitableRole, InvitationSummary } from "@/lib/workspace/invitations";
import type { WorkspaceRole } from "@/lib/workspace/roles";
import type { describeMember, describeWorkspace } from "@/lib/workspace/store";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import type { describeListedWorkflow, describeWorkflow } from "@/lib/workflow/store";
import type { TagSummary } from "@/lib/workflow/tags";
import type { WorkflowExport } from "@/lib/workflow/transfer";
import type { describeVersion } from "@/lib/workflow/versions";

/**
 * The browser's view of the Phase 3 API — CONTRACT.md → "API request/response
 * shapes". Every response is `{ data }` or `{ error: { code, message, details } }`,
 * so unwrapping and error handling belong in exactly one place.
 *
 * The imports above are all `import type`, erased at build. Nothing server-side is
 * bundled into the client; the types come from the server modules so there is one
 * definition of each shape rather than a client copy free to drift.
 */

export type Workflow = ReturnType<typeof describeWorkflow>;

/** A workflow as the list answers it — Phase 32: with its tags and the asker's star. */
export type ListedWorkflow = ReturnType<typeof describeListedWorkflow>;
export type { TagSummary, WorkflowExport };

/**
 * CONTRACT.md → "Workflow versions". `graph` is present only where the endpoint was
 * asked for it — the history list deliberately omits every snapshot and sends the
 * per-version `changes` summary instead.
 */
export type WorkflowVersion = ReturnType<typeof describeVersion>;

/** What `GET /versions/compare` answers: both sides, and what differs. */
export interface VersionComparison {
  from: WorkflowVersion & { graph: WorkflowGraph };
  to: WorkflowVersion & { graph: WorkflowGraph };
  diff: GraphDiff;
}

/** CONTRACT.md → "Workspaces and membership". Phase 19B. */
export type WorkspaceSummary = ReturnType<typeof describeWorkspace>;
export type WorkspaceMemberSummary = ReturnType<typeof describeMember>;
export type { InvitationSummary, InvitableRole, WorkspaceRole };

/**
 * CONTRACT.md → "Per-workflow sharing". Phase 20.
 *
 * `SharedWorkflow` is what the **unauthenticated** share endpoint answers, and it is a
 * different type from `Workflow` on purpose: it has no ids, no tokens and a graph whose
 * authored values are redacted. Two names for two audiences is what stops a component
 * written for one from being pointed at the other.
 */
export type { SharedWorkflow, WorkflowVisibility };

/** The one response that carries a live invitation link. It is never fetched twice. */
export interface IssuedInvitation {
  invitation: InvitationSummary;
  url: string;
}

export type { GraphDiff, NodeChange, NodeDiff, DiffSummary } from "@/lib/workflow/diff";
export type { NodeSummary, GraphProblem };
export type { ProviderSettings, ProviderState, ModelInfo };
export type { DiscordStatus, GoogleStatus, TokenIntegrationStatus };
export type { Vault, VaultEntry, RekeyOutcome };
export type { GenerationIssue, GenerationAttempt };

/** CONTRACT.md → "Generation request/response". */
export interface GenerationResponse {
  workflow: Workflow;
  generation: {
    model: string;
    source: "user" | "environment";
    /** Parts of the request no registered node can do. Shown to the user. */
    unsupported: string[];
    usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
    attempts: GenerationAttempt[];
  };
}

/** The `details` of a 422 from the generation route. */
export interface GenerationErrorDetails {
  issues: GenerationIssue[];
  attempts: GenerationAttempt[];
}

/**
 * CONTRACT.md → "Run and step records". The wire shapes live in
 * `lib/engine/stream.ts`, which the SSE route and this client both read, so a
 * streamed step and a fetched step cannot drift into two different shapes.
 */
export type { StreamRun as Run, StreamStep as RunStep } from "@/lib/engine/stream";
export type { RunSummary, StepBodies, StepHeader };
export type { RunMode, RunStatus, StepStatus } from "@/lib/engine/types";
export type { NodePolicy } from "@/lib/engine/policy";
export type { RunTest, TestScope } from "@/lib/engine/partial";

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode | "network";
  readonly details?: unknown;
  /**
   * **A way forward, when the server sent one — Phase 25.** Narrowed on construction by
   * `recoveryOf`, so a component renders a link it has already been told is an in-app path
   * rather than trusting an `href` that arrived in a response body. Null for the great
   * majority of errors, which are fixable where they are shown.
   */
  readonly recovery: Recovery | null;

  constructor(code: ApiErrorCode | "network", message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
    this.recovery = recoveryOf(details);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError("network", "Could not reach the server. Check your connection.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiRequestError("internal", `The server returned an unreadable response (${response.status}).`);
  }

  if (!response.ok) {
    const error = (body as { error?: { code: ApiErrorCode; message: string; details?: unknown } })
      .error;
    throw new ApiRequestError(
      error?.code ?? "internal",
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details,
    );
  }

  return (body as { data: T }).data;
}

export const api = {
  listWorkflows: () => request<ListedWorkflow[]>("/api/workflows"),

  createWorkflow: (body: { name: string; description?: string | null; graph?: WorkflowGraph }) =>
    request<Workflow>("/api/workflows", { method: "POST", body: JSON.stringify(body) }),

  getWorkflow: (id: string) => request<Workflow>(`/api/workflows/${id}`),

  /**
   * Clone a template into this workspace — Phase 23A. Answers the created workflow,
   * exactly as `createWorkflow` does, because on the server it *is* `createWorkflow`.
   */
  cloneTemplate: (id: string) =>
    request<Workflow>(`/api/templates/${encodeURIComponent(id)}`, { method: "POST" }),

  /**
   * Put the first-run guide away for good — Phase 25. Idempotent: a second call writes
   * nothing, so this is safe to press twice.
   */
  finishOnboarding: () =>
    request<{ onboarded: boolean }>("/api/onboarding", { method: "POST" }),

  /**
   * Natural language → a persisted workflow. Rejects with `invalid_graph` when the
   * model's output could not run; nothing is saved in that case.
   */
  generateWorkflow: (body: { prompt: string; name?: string }) =>
    request<GenerationResponse>("/api/workflows/generate", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** The whole graph goes in one PATCH — it is a single atomic row update (D14). */
  updateWorkflow: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      graph?: WorkflowGraph;
      /**
       * Who in the workspace may see it (Phase 20). On the same request as everything
       * else, and **authorised separately** — the creator or an admin, not any editor. A
       * refusal is a 403 naming why.
       */
      visibility?: WorkflowVisibility;
      /** The active switch (Phase 26). Off: the webhook refuses and the schedule stops. */
      active?: boolean;
    },
  ) => request<Workflow>(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  /**
   * Publish a read-only public link to this workflow's graph (Phase 20). Needs `admin`.
   *
   * Idempotent — an already-shared workflow answers with the link it already has rather
   * than minting a second one, so this is safe to press twice. Rotating is deliberately
   * `unshare` then `share`.
   */
  shareWorkflow: (id: string) =>
    request<Workflow>(`/api/workflows/${id}/share`, { method: "POST" }),

  /** Revoke the link. The token is discarded, so the URL is dead and cannot come back. */
  unshareWorkflow: (id: string) =>
    request<Workflow>(`/api/workflows/${id}/share`, { method: "DELETE" }),

  deleteWorkflow: (id: string) =>
    request<{ deleted: string }>(`/api/workflows/${id}`, { method: "DELETE" }),

  /* ---------------- the library — Phase 32 ---------------- */

  /** The workspace's tags, by name. Every member may read them. */
  listTags: () => request<TagSummary[]>("/api/tags"),

  /** A 409 when the workspace already has a tag of that name, ignoring case. */
  createTag: (name: string) =>
    request<TagSummary>("/api/tags", { method: "POST", body: JSON.stringify({ name }) }),

  renameTag: (id: string, name: string) =>
    request<TagSummary>(`/api/tags/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  /** It comes off every workflow wearing it. */
  deleteTag: (id: string) => request<{ deleted: string }>(`/api/tags/${id}`, { method: "DELETE" }),

  /** Replace the set of tags a workflow wears. Not a version, not an update. */
  setWorkflowTags: (id: string, tagIds: string[]) =>
    request<TagSummary[]>(`/api/workflows/${id}/tags`, {
      method: "PUT",
      body: JSON.stringify({ tagIds }),
    }),

  /** Your star, nobody else's. A viewer may star. */
  starWorkflow: (id: string, starred: boolean) =>
    request<{ starred: boolean }>(`/api/workflows/${id}/star`, {
      method: starred ? "PUT" : "DELETE",
    }),

  /** A server-side copy with its own webhook token, switched off if it would run by itself. */
  duplicateWorkflow: (id: string) =>
    request<Workflow>(`/api/workflows/${id}/duplicate`, { method: "POST" }),

  /** The export envelope. Pinned outputs are left out unless asked for (D146). */
  exportWorkflow: (id: string, options: { includePinned?: boolean } = {}) =>
    request<WorkflowExport>(
      `/api/workflows/${id}/export${options.includePinned ? "?pinned=include" : ""}`,
    ),

  /**
   * Create a workflow from an export. The body is the envelope as parsed — the server reads its
   * format and version first, and names any node type it does not have.
   */
  importWorkflow: (envelope: unknown) =>
    request<Workflow>("/api/workflows/import", { method: "POST", body: JSON.stringify(envelope) }),

  /**
   * Version history, newest first, **without the graphs**. Each entry carries what it
   * changed relative to the version below it, which is what the list prints — fetching
   * fifty snapshots to render fifty timestamps would be the obvious and wrong shape.
   */
  listVersions: (id: string) => request<WorkflowVersion[]>(`/api/workflows/${id}/versions`),

  /** One version, with its graph. */
  getVersion: (id: string, number: number) =>
    request<WorkflowVersion & { graph: WorkflowGraph }>(
      `/api/workflows/${id}/versions/${number}`,
    ),

  /** Name a version, or clear the name with `null`. A named version is never pruned. */
  labelVersion: (id: string, number: number, label: string | null) =>
    request<WorkflowVersion>(`/api/workflows/${id}/versions/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ label }),
    }),

  /**
   * Restore: writes that version's graph as a NEW version on top. It answers with the
   * workflow, whose `version` is the number the restore produced — history moves
   * forward, so the caller never has to reconcile a rewound number.
   */
  restoreVersion: (id: string, number: number) =>
    request<Workflow>(`/api/workflows/${id}/versions/${number}/restore`, { method: "POST" }),

  /** Both graphs and the diff between them. `to` defaults to the current version. */
  compareVersions: (id: string, from: number, to?: number) =>
    request<VersionComparison>(
      `/api/workflows/${id}/versions/compare?from=${from}${to === undefined ? "" : `&to=${to}`}`,
    ),

  /**
   * Synchronous: the request stays open until the run finishes and returns every step.
   * `target` tests part of the workflow — one node, or the way to it (Phase 31).
   */
  runWorkflow: (id: string, input?: unknown, target?: { scope: "node" | "path"; nodeId: string }) =>
    request<StreamRun>(`/api/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: input ?? null, mode: "sync", ...(target ? { target } : {}) }),
    }),

  /**
   * Durable: answers as soon as the run is on the queue, with a `queued` run and no
   * steps. The caller watches it over the SSE stream — the same path a webhook-triggered
   * run already used, which is why durable mode needed no new client protocol (D28).
   */
  runWorkflowDurably: (id: string, input?: unknown) =>
    request<StreamRun>(`/api/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: input ?? null, mode: "durable" }),
    }),

  /**
   * Ask a run to stop. Returns the run as it stands, which is how the caller learns which
   * of the two outcomes it got: `cancelled` already (nothing was executing it) or still
   * `running` with `cancelRequested` (a worker will stop at its next step boundary).
   */
  cancelRun: (runId: string) =>
    request<StreamRun>(`/api/runs/${runId}/cancel`, { method: "POST" }),

  /** A workflow's newest runs, as summaries — no input, output or steps (Phase 33). */
  listRuns: (workflowId: string, limit = 8) =>
    request<RunSummary[]>(`/api/workflows/${workflowId}/runs?limit=${limit}`),

  /** One run, whole: its input, output and every step with its bodies. */
  getRun: (runId: string) => request<StreamRun>(`/api/runs/${runId}`),

  /** One step's config, input and output — loaded when it is opened (Phase 33). */
  getStepBodies: (runId: string, seq: number) => request<StepBodies>(`/api/runs/${runId}/steps/${seq}`),

  /**
   * Start a run from this one — Phase 33: `rerun` from the trigger with its input, `retry` from the
   * step it failed at. `durable` answers as soon as the new run is queued, which is what a page
   * that then opens the new run wants.
   */
  restartRun: (runId: string, kind: "rerun" | "retry", mode: "sync" | "durable" = "durable") =>
    request<StreamRun>(`/api/runs/${runId}/${kind}`, {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),

  /**
   * Provider settings. Write-only by design: none of these ever returns the stored
   * key, so there is no accessor here that could.
   */
  getProviderSettings: () => request<ProviderSettings>("/api/settings/provider"),

  /**
   * `provider` names which provider the change is about — Phase 23D. Sent alone it switches
   * provider and verifies nothing; sent with a key it stores that key for that provider and
   * switches to it in one request, which is what pasting a key into a card means.
   */
  saveProviderSettings: (body: { provider?: string; apiKey?: string; model?: string }) =>
    request<ProviderSettings>("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteProviderSettings: (provider?: string) =>
    request<ProviderSettings>(
      provider
        ? `/api/settings/provider?provider=${encodeURIComponent(provider)}`
        : "/api/settings/provider",
      { method: "DELETE" },
    ),

  /** Live from the provider, using the caller's stored key for it. */
  listProviderModels: (provider?: string) =>
    request<{ models: ModelInfo[]; source: "user" | "environment"; provider: string }>(
      provider
        ? `/api/settings/provider/models?provider=${encodeURIComponent(provider)}`
        : "/api/settings/provider/models",
    ),

  /**
   * Integration credentials. Write-only on the same terms as the provider key: the
   * Discord webhook URL is a bearer secret and the Google refresh token never leaves
   * the server, so neither shape here carries either.
   *
   * There is no `connectGoogle` — consent is a navigation the browser has to make
   * itself, so the settings page links to `/api/integrations/google/connect` rather
   * than fetching it.
   */
  getDiscordIntegration: () => request<DiscordStatus>("/api/integrations/discord"),

  saveDiscordIntegration: (body: { webhookUrl: string }) =>
    request<DiscordStatus>("/api/integrations/discord", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteDiscordIntegration: () =>
    request<DiscordStatus>("/api/integrations/discord", { method: "DELETE" }),

  getGoogleIntegration: () => request<GoogleStatus>("/api/integrations/google"),

  disconnectGoogleIntegration: () =>
    request<GoogleStatus>("/api/integrations/google", { method: "DELETE" }),

  /* --------- the token integrations (Phase 23B): slack, notion, github, airtable ------- */
  //
  // Three methods for four services rather than twelve for four, because they go to one
  // dynamic route keyed by the registry slug. Adding a fifth integration adds no client code
  // at all — which is the point of `lib/integrations/tokens.ts`.

  getTokenIntegration: (slug: string) =>
    request<TokenIntegrationStatus>(`/api/integrations/${encodeURIComponent(slug)}`),

  saveTokenIntegration: (slug: string, secret: string) =>
    request<TokenIntegrationStatus>(`/api/integrations/${encodeURIComponent(slug)}`, {
      method: "PUT",
      body: JSON.stringify({ secret }),
    }),

  deleteTokenIntegration: (slug: string) =>
    request<TokenIntegrationStatus>(`/api/integrations/${encodeURIComponent(slug)}`, {
      method: "DELETE",
    }),

  /* ------------------ the credential vault (Phase 21) ------------------ */
  //
  // Read is `viewer`, rotation and revocation are `admin`, re-keying is `owner`. Every
  // response is the whole vault rather than one entry: it costs one query and it means the
  // page cannot be left showing a stale rotation count beside a row that just changed.

  getVault: () => request<Vault>("/api/credentials"),

  /**
   * Replace a stored secret in place. The new one is proved against the provider before
   * anything is written, so a wrong value is a 400 and the old secret is untouched.
   */
  rotateCredential: (kind: string, secret: string) =>
    request<Vault>(`/api/credentials/${encodeURIComponent(kind)}/rotate`, {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),

  /** Re-wrap this workspace's data keys under the current root key. No secret is decrypted. */
  rekeyCredentials: () =>
    request<{ rekey: RekeyOutcome; vault: Vault }>("/api/credentials/rekey", { method: "POST" }),

  /**
   * Mint a new webhook URL for this workflow. **The old one answers 404 from the moment this
   * resolves**, so the caller has to be a deliberate, confirmed action rather than a button
   * beside the URL.
   */
  rotateWebhookToken: (id: string) =>
    request<Workflow>(`/api/workflows/${id}/webhook/rotate`, { method: "POST" }),

  /* ---------------------- workspaces (Phase 19B) ---------------------- */

  listWorkspaces: () => request<WorkspaceSummary[]>("/api/workspaces"),

  /** Creates it and switches to it — the response sets the active-workspace cookie. */
  createWorkspace: (body: { name: string }) =>
    request<WorkspaceSummary>("/api/workspaces", { method: "POST", body: JSON.stringify(body) }),

  renameWorkspace: (id: string, body: { name: string }) =>
    request<WorkspaceSummary>(`/api/workspaces/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /**
   * Switch. The cookie is set on the response, so the caller must `router.refresh()`
   * afterwards — every page is a server component and the workspace is resolved there.
   */
  switchWorkspace: (workspaceId: string) =>
    request<WorkspaceSummary>("/api/workspaces/active", {
      method: "POST",
      body: JSON.stringify({ workspaceId }),
    }),

  listMembers: (id: string) => request<WorkspaceMemberSummary[]>(`/api/workspaces/${id}/members`),

  /** Removes a member, or — aimed at your own id — leaves the workspace. */
  removeMember: (id: string, userId: string) =>
    request<{ removed: string }>(`/api/workspaces/${id}/members/${userId}`, { method: "DELETE" }),

  /**
   * Change a member's role (Phase 20). Answers with the member as they now are.
   *
   * What it refuses is worth knowing at the call site, because the UI hides most of it:
   * granting or removing ownership needs `owner`, demoting the sole owner is a 409, and a
   * role that is already held is a 409 too — which means the list this was drawn from is
   * stale and should be re-fetched.
   */
  changeMemberRole: (id: string, userId: string, role: WorkspaceRole) =>
    request<WorkspaceMemberSummary>(`/api/workspaces/${id}/members/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),

  listInvitations: (id: string) =>
    request<InvitationSummary[]>(`/api/workspaces/${id}/invitations`),

  /**
   * Invite, or re-invite. **The `url` in the response is the only time the link exists** —
   * only a hash of the token is stored, so it cannot be fetched again. Re-inviting the
   * same address rotates the token and answers with the new link.
   */
  inviteToWorkspace: (id: string, body: { email: string; role: InvitableRole }) =>
    request<IssuedInvitation>(`/api/workspaces/${id}/invitations`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  revokeInvitation: (id: string, invitationId: string) =>
    request<InvitationSummary>(`/api/workspaces/${id}/invitations/${invitationId}`, {
      method: "DELETE",
    }),

  /** Accept one. Switches to the workspace on success, by the same cookie mechanism. */
  acceptInvitation: (token: string) =>
    request<WorkspaceSummary>(`/api/invitations/${token}/accept`, { method: "POST" }),
};
