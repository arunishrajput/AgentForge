import {
  apiErrorMessage,
  IntegrationError,
  type ReadBody,
  readBody,
  request,
  RETRY_STATUSES,
} from "./net";

/**
 * GitHub issues — Phase 23B.
 *
 * **Issues only, and nothing that touches code.** A node that could push a commit, open a
 * pull request or change a workflow file would hand the agent write access to a repository's
 * contents, and `CLAUDE.md`'s security rules already say where that ends. Filing an issue and
 * commenting on one are the two acts that are *additive*, visible, and trivially reversible by
 * a human, which is the line worth drawing for a capability a model may reach.
 *
 * **The token's own repository selection is the real boundary**, not this module. A
 * fine-grained personal access token is minted against selected repositories with selected
 * permissions, so an `owner/repo` the user did not grant answers 404 regardless of what a
 * config field says. That is what makes `repo` safe to expose as configuration.
 */

export const GITHUB_CREDENTIAL_KIND = "integration.github";

/**
 * **Pinned deliberately.** GitHub recommends sending `X-GitHub-Api-Version` on every request
 * and answers 400 to a version it no longer serves, so the choice is between pinning a
 * version and silently riding whatever the default becomes. This is the version the live REST
 * documentation showed as current on 2026-10-01; `verify-integrations.mjs` proves it against
 * the real API, so a stale value here fails loudly rather than quietly.
 */
export const GITHUB_API_VERSION = "2026-03-10";

const API = "https://api.github.com";
const TIMEOUT_MS = 15_000;

/** GitHub's own limit on an issue body. */
export const GITHUB_BODY_LIMIT = 65_536;

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": GITHUB_API_VERSION,
    "content-type": "application/json",
  };
}

/**
 * `owner/repo`, from either that or a pasted repository URL.
 *
 * The character classes are GitHub's: an owner is alphanumeric with single hyphens, a
 * repository name also allows `.` and `_`. Validated here rather than at the call site
 * because both halves go straight into a URL path, and a path segment built from unvalidated
 * config is how a request ends up somewhere other than where it was meant to.
 */
export function parseRepo(raw: string): { owner: string; repo: string } {
  const trimmed = raw.trim().replace(/\.git$/, "").replace(/\/$/, "");
  if (trimmed.length === 0) {
    throw new IntegrationError("No GitHub repository was given.");
  }

  const withoutHost = trimmed.replace(/^https?:\/\/(?:www\.)?github\.com\//i, "");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38})\/([A-Za-z0-9._-]{1,100})$/.exec(
    withoutHost,
  );

  if (!match) {
    throw new IntegrationError(
      `"${trimmed.slice(0, 80)}" is not a GitHub repository. Give it as owner/repo, e.g. octocat/hello-world.`,
    );
  }
  return { owner: match[1], repo: match[2] };
}

export interface GitHubIdentity {
  /** The account the token acts as, when GitHub will say. */
  login: string | null;
}

/**
 * Prove the token.
 *
 * **Two endpoints, because one is not enough for both token types.** `GET /user` names the
 * account and is the useful answer, but a fine-grained token created with no account
 * permissions answers 403 to it while being a perfectly valid token for filing issues.
 * Refusing that token would be this module being wrong about GitHub rather than the user
 * being wrong about their token — so a 403 falls back to `GET /rate_limit`, which never
 * requires a permission and proves only what is actually being asked here: that GitHub
 * accepts this credential. The identity is then honestly reported as unknown.
 *
 * A 401 is not retried or softened. That is a bad token, and it is the one answer the user
 * can act on immediately.
 */
export async function verifyToken(token: string, signal?: AbortSignal): Promise<GitHubIdentity> {
  const response = await request(`${API}/user`, {
    headers: headers(token),
    timeoutMs: TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);

  if (response.ok) {
    const login = (body.json as { login?: unknown } | null)?.login;
    return { login: typeof login === "string" ? login : null };
  }

  if (response.status === 403) {
    await assertTokenAccepted(token, signal);
    return { login: null };
  }

  throw githubError(body, response.status, "check that token");
}

/** The permission-free fallback. See `verifyToken`. */
async function assertTokenAccepted(token: string, signal?: AbortSignal): Promise<void> {
  const response = await request(`${API}/rate_limit`, {
    headers: headers(token),
    timeoutMs: TIMEOUT_MS,
    ...(signal ? { signal } : {}),
    retry: { attempts: 2, on: RETRY_STATUSES, onTransportError: true },
  });

  const body = await readBody(response);
  if (!response.ok) throw githubError(body, response.status, "check that token");
}

export interface GitHubIssueResult {
  number: number;
  url: string | null;
  repo: string;
}

/**
 * File an issue. 201 on success.
 *
 * Not retried on a transport error: an issue that was created without the answer arriving
 * would be filed twice, and a duplicate issue in somebody's tracker is worse than a failed
 * step naming the reason.
 */
export async function createIssue(
  token: string,
  options: {
    owner: string;
    repo: string;
    title: string;
    body: string;
    labels: string[];
    signal?: AbortSignal;
  },
): Promise<GitHubIssueResult> {
  const response = await request(
    `${API}/repos/${options.owner}/${options.repo}/issues`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({
        title: options.title,
        ...(options.body.length > 0 ? { body: options.body } : {}),
        ...(options.labels.length > 0 ? { labels: options.labels } : {}),
      }),
      timeoutMs: TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      retry: { attempts: 2, on: RETRY_STATUSES },
    },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw githubError(body, response.status, `open an issue in ${options.owner}/${options.repo}`);
  }

  return readIssue(body.json, `${options.owner}/${options.repo}`);
}

/** Comment on an existing issue or pull request. */
export async function commentOnIssue(
  token: string,
  options: {
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
    signal?: AbortSignal;
  },
): Promise<GitHubIssueResult> {
  const response = await request(
    `${API}/repos/${options.owner}/${options.repo}/issues/${options.issueNumber}/comments`,
    {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ body: options.body }),
      timeoutMs: TIMEOUT_MS,
      ...(options.signal ? { signal: options.signal } : {}),
      retry: { attempts: 2, on: RETRY_STATUSES },
    },
  );

  const body = await readBody(response);
  if (!response.ok) {
    throw githubError(
      body,
      response.status,
      `comment on ${options.owner}/${options.repo}#${options.issueNumber}`,
    );
  }

  const url = (body.json as { html_url?: unknown } | null)?.html_url;
  return {
    number: options.issueNumber,
    url: typeof url === "string" ? url : null,
    repo: `${options.owner}/${options.repo}`,
  };
}

function readIssue(json: unknown, repo: string): GitHubIssueResult {
  const record = (json ?? {}) as { number?: unknown; html_url?: unknown };
  if (typeof record.number !== "number") {
    throw new IntegrationError("GitHub created the issue but returned no issue number.");
  }
  return {
    number: record.number,
    url: typeof record.html_url === "string" ? record.html_url : null,
    repo,
  };
}

/**
 * GitHub's own words, plus the missing advice.
 *
 * **A 404 on a repository that exists means the token was not granted it**, because GitHub
 * deliberately answers 404 rather than 403 for a resource a credential cannot see — that is
 * how it avoids confirming that a private repository exists. Reported as a permissions
 * problem, because that is what it is nine times out of ten, without claiming the repository
 * definitely exists.
 */
function githubError(
  body: ReadBody,
  status: number,
  attempt: string,
): IntegrationError {
  const message = apiErrorMessage(body, `HTTP ${status}`);

  if (status === 401) {
    return new IntegrationError(`GitHub rejected the token: ${message}.`, status);
  }
  if (status === 404) {
    return new IntegrationError(
      `GitHub could not ${attempt}: ${message}. Either it does not exist, or this token was not granted access to it — a fine-grained token only reaches the repositories you selected when you created it.`,
      status,
    );
  }
  if (status === 403) {
    return new IntegrationError(
      `GitHub refused to ${attempt}: ${message}. Check that the token grants the Issues permission as read and write.`,
      status,
    );
  }
  if (status === 410) {
    return new IntegrationError(`GitHub could not ${attempt}: issues are disabled on that repository.`, status);
  }
  return new IntegrationError(`GitHub could not ${attempt}: ${message}.`, status);
}
