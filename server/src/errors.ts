export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function badRequest(message: string, details?: unknown) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = "Unauthorized") {
  return new HttpError(401, message);
}

export function forbidden(message = "Forbidden", details?: unknown) {
  return new HttpError(403, message, details);
}

/**
 * 403 Paywall error — returned when the company's subscription tier
 * does not include a required feature.
 *
 * The `code` field distinguishes paywall denials from generic 403s
 * so the frontend can show upgrade prompts.
 */
export function paywall(
  message: string,
  details?: { featureKey?: string; tierName?: string; requiredPlan?: string },
) {
  const err = new HttpError(403, message, details);
  Object.defineProperty(err, "code", { value: "PAYWALL", enumerable: true });
  return err;
}

export function notFound(message = "Not found", details?: unknown) {
  return new HttpError(404, message, details);
}

export function conflict(message: string, details?: unknown) {
  return new HttpError(409, message, details);
}

export function unprocessable(message: string, details?: unknown) {
  return new HttpError(422, message, details);
}
