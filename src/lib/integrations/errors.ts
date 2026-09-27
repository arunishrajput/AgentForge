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
 */
export function integrationApiError(service: string, error: unknown): ApiError {
  if (error instanceof IntegrationError) {
    return new ApiError("invalid_request", error.message);
  }
  console.error(`Unhandled error in the ${service} integration:`, error);
  return new ApiError("internal", `Something went wrong saving this ${service} connection.`);
}
