import { z } from "zod";

import { checkTarget } from "@/lib/integrations/guard";
import { apiErrorMessage, readBody, request } from "@/lib/integrations/net";

import { defineNode, NodeError } from "../types";
import { asNodeError, jsonRecord } from "./shared";

/**
 * Call any HTTPS API.
 *
 * **This is the node that had to be got right.** `BUILD_PLAN.md` Phase 9 says it is
 * not an agent escape hatch — it is a registry entry with a schema, reached the same
 * way as any other node. Making that true rather than aspirational is the whole of
 * `src/lib/integrations/guard.ts`: with `agentCallable: true`, the *destination* is
 * chosen by a model reading text that may have arrived on an unauthenticated webhook,
 * so the guard refuses non-public addresses and refuses plain HTTP — which is what
 * closes `http://169.254.169.254/…/token`, one GET away from a Google access token
 * for this container's own service identity.
 *
 * Redirects are reported, never followed. Following one re-resolves a host that the
 * guard has already cleared, which hands the checked address back to whoever controls
 * the redirect; and a JSON API that answers an API call with a 302 is telling the
 * author something they should see.
 */
export const httpNode = defineNode({
  type: "integration.http",
  label: "HTTP request",
  description:
    "Calls an HTTPS API and outputs its response. Use it to fetch or send data to any web service that is not covered by a dedicated node. The URL must be https and must be a public address; redirects are reported rather than followed.",
  kind: "action",
  category: "integration",
  outputs: [{ key: null, label: "Out" }],
  outputShape:
    "{ status: the HTTP status number, ok: true for 2xx, json: the parsed response body or null, text: the raw response body, contentType, redirectedTo }. For a JSON API, reference output.json.field.",
  agentCallable: true,
  configSchema: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    /**
     * Not `z.string().url()`. This field routinely holds `{{trigger.endpoint}}`, and
     * URL validation would reject the template before the engine ever resolved it.
     * The real check is `checkTarget` at execution time, on the resolved value, which
     * is the only value that matters. 2000 characters means it renders as a textarea
     * rather than a single-line input, which is the right trade for a field that can
     * legitimately carry a long query string.
     */
    url: z.string().trim().min(1).max(2000),
    headers: jsonRecord(
      "Request headers as an object of string values, e.g. an authorization header. Omit unless the API needs them.",
    ),
    /**
     * A string rather than a JSON object: it is the field most likely to hold a
     * `{{ }}` reference, and D17 keeps those lookups rather than expressions, so the
     * author composes the body text themselves and knows exactly what is sent.
     */
    body: z.string().max(100_000).optional(),
    timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
    /**
     * Defaults to failing the step on a non-2xx, which is the honest default: an
     * author who wrote an explicit API call almost always wants a 404 to stop the
     * run and show the API's own message, not to succeed carrying an error page as
     * data — the "valid run, wrong result" hazard PROGRESS.md records. Set false to
     * probe a status deliberately and route on `output.ok` instead.
     */
    failOnError: z.boolean().default(true),
  }),
  async execute({ config, context }) {
    try {
      const { url, addresses } = await checkTarget(config.url);
      context.log(`${config.method} ${url.host}${url.pathname} (${addresses[0]})`);

      const sendsBody = config.method !== "GET" && config.body !== undefined;
      const response = await request(url.toString(), {
        method: config.method,
        headers: {
          ...(sendsBody && !hasContentType(config.headers)
            ? { "content-type": "application/json" }
            : {}),
          ...config.headers,
        },
        ...(sendsBody ? { body: config.body } : {}),
        timeoutMs: config.timeoutMs,
        signal: context.signal,
        redirect: "manual",
      });

      const body = await readBody(response);
      const redirectedTo = response.status >= 300 && response.status < 400
        ? response.headers.get("location")
        : null;

      if (redirectedTo) {
        context.log(
          `${response.status}: redirected to ${redirectedTo}. Not followed — point the node at the final URL.`,
          "warn",
        );
      } else {
        context.log(
          `${response.status} ${response.statusText || ""}`.trim() +
            (body.truncated ? " (response truncated)" : ""),
          response.ok ? "info" : "warn",
        );
      }

      if (config.failOnError && !response.ok && !redirectedTo) {
        throw new NodeError(
          `${config.method} ${url.host}${url.pathname} answered ${response.status}: ${
            apiErrorMessage(body, response.statusText || "no message")
          }`,
        );
      }

      return {
        output: {
          status: response.status,
          ok: response.ok,
          contentType: response.headers.get("content-type"),
          json: body.json,
          text: body.text,
          truncated: body.truncated,
          redirectedTo,
        },
      };
    } catch (error) {
      throw asNodeError(error);
    }
  },
});

/**
 * A caller who set their own content type keeps it. The default is only applied when
 * a body is being sent and nothing said what it is — the common case being JSON, and
 * the common failure being an API answering 415 because nobody set the header.
 */
function hasContentType(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === "content-type");
}
