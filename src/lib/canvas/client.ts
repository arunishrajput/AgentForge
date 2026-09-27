import type { ProviderSettings } from "@/lib/ai/settings";
import type { GenerationAttempt, GenerationIssue } from "@/lib/generate/generate";
import type { ModelInfo } from "@/lib/ai/types";
import type { ApiErrorCode } from "@/lib/api";
import type { StreamRun } from "@/lib/engine/stream";
import type { GraphProblem } from "@/lib/engine/validate";
import type { DiscordStatus, GoogleStatus } from "@/lib/integrations/store";
import type { NodeSummary } from "@/lib/nodes";
import type { GraphDiff } from "@/lib/workflow/diff";
import type { InvitableRole, InvitationSummary } from "@/lib/workspace/invitations";
import type { describeMember, describeWorkspace } from "@/lib/workspace/store";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import type { describeWorkflow } from "@/lib/workflow/store";
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
export type { InvitationSummary, InvitableRole };

/** The one response that carries a live invitation link. It is never fetched twice. */
export interface IssuedInvitation {
  invitation: InvitationSummary;
  url: string;
}

export type { GraphDiff, NodeChange, NodeDiff, DiffSummary } from "@/lib/workflow/diff";
export type { NodeSummary, GraphProblem };
export type { ProviderSettings, ModelInfo };
export type { DiscordStatus, GoogleStatus };
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
export type { RunMode, RunStatus, StepStatus } from "@/lib/engine/types";
export type { NodePolicy } from "@/lib/engine/policy";

export class ApiRequestError extends Error {
  readonly code: ApiErrorCode | "network";
  readonly details?: unknown;

  constructor(code: ApiErrorCode | "network", message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.details = details;
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
  listWorkflows: () => request<Workflow[]>("/api/workflows"),

  createWorkflow: (body: { name: string; description?: string | null; graph?: WorkflowGraph }) =>
    request<Workflow>("/api/workflows", { method: "POST", body: JSON.stringify(body) }),

  getWorkflow: (id: string) => request<Workflow>(`/api/workflows/${id}`),

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
    body: { name?: string; description?: string | null; graph?: WorkflowGraph },
  ) => request<Workflow>(`/api/workflows/${id}`, { method: "PATCH", body: JSON.stringify(body) }),

  deleteWorkflow: (id: string) =>
    request<{ deleted: string }>(`/api/workflows/${id}`, { method: "DELETE" }),

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

  /** Synchronous: the request stays open until the run finishes and returns every step. */
  runWorkflow: (id: string, input?: unknown) =>
    request<StreamRun>(`/api/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: input ?? null, mode: "sync" }),
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

  listRuns: (workflowId: string) => request<StreamRun[]>(`/api/workflows/${workflowId}/runs`),

  /**
   * Provider settings. Write-only by design: none of these ever returns the stored
   * key, so there is no accessor here that could.
   */
  getProviderSettings: () => request<ProviderSettings>("/api/settings/provider"),

  saveProviderSettings: (body: { apiKey?: string; model?: string }) =>
    request<ProviderSettings>("/api/settings/provider", {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  deleteProviderSettings: () =>
    request<ProviderSettings>("/api/settings/provider", { method: "DELETE" }),

  /** Live from the provider, using the caller's stored key. */
  listProviderModels: () =>
    request<{ models: ModelInfo[]; source: "user" | "environment" }>(
      "/api/settings/provider/models",
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
