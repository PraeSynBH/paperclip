/**
 * AuthProvider interface — decouples auth checks from Paperclip's
 * concrete actor middleware implementation.
 *
 * Voyonder calls these methods; Paperclip provides the real implementation
 * that reads the actor context from the request.
 *
 * The `Request` type is intentionally generic (not tied to Express) to
 * keep the shared package dependency-free. In production, Paperclip passes
 * the Express Request object which has been enriched by its auth middleware
 * with `req.actor`.
 */

/**
 * Minimal actor shape expected by the auth provider.
 */
export interface AuthActor {
  type: string;
  agentId?: string;
  userId?: string;
  companyId?: string;
  companyIds?: string[];
}

/**
 * Minimal request shape with an actor property.
 * The concrete implementation (e.g. Paperclip's Express middleware)
 * will have a full Request object; this interface captures only what
 * Voyonder's auth checks need.
 */
export interface AuthRequest {
  actor: AuthActor;
}

/**
 * AuthProvider interface — decouples auth checks from Paperclip's
 * concrete actor middleware implementation.
 */
export interface AuthProvider {
  /**
   * Assert the request has an authenticated actor and that the actor
   * has access to the given company.
   *
   * Returns the resolved companyId, actorType, and actorId on success.
   * Throws an HTTP error (unauthorized/forbidden) on failure.
   */
  assertCompanyAccess(req: AuthRequest, companyId: string): Promise<{
    companyId: string;
    actorType: string;
    actorId: string;
  }>;

  /**
   * Assert that the actor is allowed to read within the given company scope.
   * A stricter check than basic company access — verifies read permissions.
   */
  assertCompanyScopeReadAllowed(
    companyId: string,
    actor: AuthActor,
  ): Promise<void>;
}