import { logError } from "@/lib/logging";
import { ApiError } from "@/lib/api-error";

import { IntegrationError } from "./net";

/**
 * Turning an integration failure into an API error.
 *
 * **Only an `IntegrationError` came from the third-party service.** Anything else came
 * from this application — a database error, a bug — and reporting it as though the
 * service were at fault sends whoever is diagnosing it to the wrong place.
 *
 * Phase 19A learned that the expensive way. `putCredential` was failing on a missing
 * unique index, and the Discord route's mapper turned that into *"Could not reach
 * Discord."* — for a request in which Discord had already answered successfully. The
 * message now admits it does not know, and the cause is logged where an operator can
 * find it rather than shaped into a story.
 *
 * The provider's own words are still passed through for the failures that genuinely are
 * the provider's, because "Unknown Webhook" is what tells a user their webhook was
 * deleted, and that is something they can act on. The credential itself is never echoed.
 *
 * **An `ApiError` passes through unchanged — Phase 21, and it is a bug fix.** The vault's
 * rotation route wrapped its whole body in this mapper, which turned every deliberate refusal
 * underneath it into a 500: an unknown credential kind, a Google connection explaining that a
 * refresh token cannot be typed, and a key the provider had rejected all came back as
 * *"Something went wrong saving this The provider connection."* Found by the deployed check
 * suite, which is the only place a route's error mapping is visible.
 *
 * Fixed here rather than at that one call site, because the defect is a class: an `ApiError` is
 * by construction a refusal that already carries its own code and its own client-safe message,
 * so re-deciding either of those is always wrong, in every caller, present and future.
 */
export function integrationApiError(service: string, error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof IntegrationError) {
    return new ApiError("invalid_request", error.message);
  }
  logError("api.error", `An unexpected error came out of the ${service} integration.`, error, {
    service,
  });
  return new ApiError("internal", `Something went wrong saving this ${service} connection.`);
}
