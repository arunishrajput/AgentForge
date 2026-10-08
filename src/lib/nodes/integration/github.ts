import { z } from "zod";

import {
  commentOnIssue,
  createIssue,
  GITHUB_BODY_LIMIT,
  parseRepo,
} from "@/lib/integrations/github";
import { readTokenSecret } from "@/lib/integrations/store";
import { tokenIntegrationBySlug } from "@/lib/integrations/tokens";

import { defineNode, NodeError } from "../types";
import { asNodeError } from "./shared";

const github = tokenIntegrationBySlug("github")!;

/**
 * File a GitHub issue, or comment on one.
 *
 * **Agent-callable, and the boundary is the token rather than this file.** A fine-grained
 * personal access token is minted against selected repositories with selected permissions, so
 * a model that writes any other `owner/repo` into the config gets a 404 from GitHub — which is
 * why `repo` is safe as configuration in a way a shell command never would be.
 *
 * **Issues and comments only, deliberately.** Both acts are additive, visible in a place humans
 * already watch, and closed or deleted by one click. Nothing here touches code, branches or
 * workflow files, and that line is where a capability stops being safe to widen (`CLAUDE.md` →
 * *Security rules*).
 */
export const githubNode = defineNode({
  type: "integration.github",
  label: "GitHub issue",
  description:
    "Files a GitHub issue, or comments on an existing one, using the workspace's connected token. Operation \"createIssue\" needs repo and title; \"commentOnIssue\" needs repo, issueNumber and body. Give repo as owner/name. It can only reach the repositories the stored token was granted, and it never changes code.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ operation, repo: owner/name, number: the issue number, url: the link to the issue or the comment }.",
  agentCallable: true,
  docs: {
    summary:
      "Turns something a workflow found into a GitHub issue, or adds a comment to an issue that already exists. Good for putting a failure, a support request or a scheduled review somewhere a team already looks, rather than in a chat message that scrolls away.",
    accepts:
      "Nothing in particular. Write the title and body yourself, using `{{ }}` references for anything an earlier step produced.",
    examples: [
      {
        title: "File what a webhook reported",
        body: "operation: createIssue · repo: acme/api · title: \"{{trigger.subject}}\" · labels: [\"bug\"]",
      },
      {
        title: "Comment on the issue a previous step opened",
        body: "operation: commentOnIssue · repo: acme/api · issueNumber: {{steps.file.output.number}} · body: \"Run finished.\"",
      },
    ],
  },
  effect: { does: "open an issue or post a comment on GitHub" },
  configSchema: z.object({
    operation: z.enum(["createIssue", "commentOnIssue"]).default("createIssue"),
    /** Empty is allowed for the same reason `integration.sheets` allows an empty id. */
    repo: z.string().trim().max(200).default(""),
    title: z.string().trim().max(300).default(""),
    body: z.string().max(GITHUB_BODY_LIMIT).default(""),
    /** Only read by `commentOnIssue`. */
    issueNumber: z.number().int().positive().max(9_999_999).optional(),
    /**
     * GitHub silently drops labels for a token without push access rather than failing, which
     * is worth knowing but not worth refusing over — a filed issue with no label is still a
     * filed issue.
     */
    labels: z.array(z.string().trim().min(1).max(50)).max(10).default([]),
  }),
  async execute({ config, context }) {
    if (config.repo.length === 0) {
      throw new NodeError(
        "This node has no repository yet. Open it and give it one as owner/name.",
      );
    }

    try {
      const { owner, repo } = parseRepo(config.repo);

      const token = await readTokenSecret(context.scope, github, {
        runId: context.runId,
        nodeId: context.nodeId,
        nodeType: context.nodeType,
        purpose: config.operation,
      });

      if (config.operation === "createIssue") {
        if (config.title.length === 0) {
          throw new NodeError("A GitHub issue needs a title. Open the node and give it one.");
        }

        const result = await createIssue(token, {
          owner,
          repo,
          title: config.title,
          body: config.body,
          labels: config.labels,
          ...(context.signal ? { signal: context.signal } : {}),
        });

        context.log(`Opened ${result.repo}#${result.number}.`);
        return { output: { operation: config.operation, ...result } };
      }

      if (config.issueNumber === undefined) {
        throw new NodeError(
          "Commenting needs an issue number. Open the node and set issueNumber.",
        );
      }
      if (config.body.trim().length === 0) {
        throw new NodeError("A GitHub comment needs a body. Open the node and write one.");
      }

      const result = await commentOnIssue(token, {
        owner,
        repo,
        issueNumber: config.issueNumber,
        body: config.body,
        ...(context.signal ? { signal: context.signal } : {}),
      });

      context.log(`Commented on ${result.repo}#${result.number}.`);
      return { output: { operation: config.operation, ...result } };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});
