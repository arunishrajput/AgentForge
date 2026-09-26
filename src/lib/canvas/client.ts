import type { ProviderSettings } from "@/lib/ai/settings";
import type { GenerationAttempt, GenerationIssue } from "@/lib/generate/generate";
import type { ModelInfo } from "@/lib/ai/types";
import type { ApiErrorCode } from "@/lib/api";
import type { StreamRun } from "@/lib/engine/stream";
import type { GraphProblem } from "@/lib/engine/validate";
import type { NodeSummary } from "@/lib/nodes";
import type { WorkflowGraph } from "@/lib/workflow/graph";
import type { describeWorkflow } from "@/lib/workflow/store";

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
export type { NodeSummary, GraphProblem };
export type { ProviderSettings, ModelInfo };
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
export type { RunStatus, StepStatus } from "@/lib/engine/types";

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

  /** Synchronous: the request stays open until the run finishes and returns every step. */
  runWorkflow: (id: string, input?: unknown) =>
    request<StreamRun>(`/api/workflows/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ input: input ?? null }),
    }),

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
};
