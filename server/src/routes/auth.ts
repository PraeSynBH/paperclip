import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authUsers, companies as companiesTable } from "@paperclipai/db";
import {
  authSessionSchema,
  currentUserProfileSchema,
  updateCurrentUserProfileSchema,
  completeRegistrationSchema,
  type CompleteRegistration,
} from "@paperclipai/shared";
import { unauthorized, forbidden } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { logger } from "../middleware/logger.js";
import { billingService } from "../services/billing.js";
import { companyService } from "../services/companies.js";
import { accessService, logActivity } from "../services/index.js";

async function loadCurrentUserProfile(db: Db, userId: string) {
  const user = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      image: authUsers.image,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .then((rows) => rows[0] ?? null);

  if (!user) {
    throw unauthorized("Signed-in user not found");
  }

  return currentUserProfileSchema.parse({
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
    image: user.image ?? null,
  });
}

export function authRoutes(db: Db) {
  const router = Router();

  router.get("/get-session", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    const user = await loadCurrentUserProfile(db, req.actor.userId);
    res.json(authSessionSchema.parse({
      session: {
        id: `paperclip:${req.actor.source ?? "none"}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user,
    }));
  });

  router.get("/profile", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    res.json(await loadCurrentUserProfile(db, req.actor.userId));
  });

  router.patch("/profile", validate(updateCurrentUserProfileSchema), async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      throw unauthorized("Board authentication required");
    }

    const patch = updateCurrentUserProfileSchema.parse(req.body);
    const now = new Date();

    const updated = await db
      .update(authUsers)
      .set({
        name: patch.name,
        ...(patch.image !== undefined ? { image: patch.image } : {}),
        updatedAt: now,
      })
      .where(eq(authUsers.id, req.actor.userId))
      .returning({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        image: authUsers.image,
      })
      .then((rows) => rows[0] ?? null);

    if (!updated) {
      throw unauthorized("Signed-in user not found");
    }

    res.json(currentUserProfileSchema.parse({
      id: updated.id,
      email: updated.email ?? null,
      name: updated.name ?? null,
      image: updated.image ?? null,
    }));
  });

  /**
   * POST /api/auth/complete-registration
   *
   * Called after better-auth sign-up to create a company and start a trial.
   * Requires an authenticated user session.
   */
  router.post(
    "/complete-registration",
    validate(completeRegistrationSchema),
    async (req, res) => {
      if (req.actor.type !== "board" || !req.actor.userId) {
        throw forbidden("A valid user session is required");
      }

      const body = req.body as CompleteRegistration;
      const userId = req.actor.userId;

      // Check existing membership and create company + membership + trial
      // atomically inside a transaction with FOR UPDATE to prevent concurrent
      // registration races (M6-2). We also acquire a user-scoped advisory lock
      // to serialize the case where no membership row exists yet (FOR UPDATE
      // only locks existing rows, so two simultaneous requests with no
      // membership could both miss the check without the advisory lock).
      // Errors from startTrial propagate as 503 so the caller can retry (M6-1).
      const result = await db.transaction(async (tx) => {
        // Acquire a transaction-scoped advisory lock on the user ID so that
        // two concurrent registration requests from the same user are
        // serialized regardless of whether a membership row exists yet.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);

        // Check membership with pessimistic lock — prevents two simultaneous
        // requests from the same user both passing the check (M6-2)
        const [existingMembership] = await tx.execute<{ companyId: string }>(sql`
          SELECT cm."company_id" as "companyId"
          FROM "company_memberships" cm
          WHERE cm."member_type" = 'user'
            AND cm."member_id" = ${userId}
            AND cm."status" = 'active'
          LIMIT 1
          FOR UPDATE
        `);

        if (existingMembership) {
          return { kind: "existing" as const, companyId: existingMembership.companyId };
        }

        // Create company using transaction-bound service instances
        const companies = companyService(tx as unknown as Db);
        const access = accessService(tx as unknown as Db);

        const company = await companies.create({
          name: body.companyName?.trim() || "My Company",
          defaultResponsibleUserId: userId,
        });

        // Ensure membership (owner)
        await access.ensureMembership(company.id, "user", userId, "owner", "active");
        await access.ensureRoleDefaultGrants(company.id, userId, "owner", userId);

        // Start trial subscription — errors propagate (M6-1)
        const trialDays = body.trialDays ?? 14;
        const billing = billingService(tx as unknown as Db);
        await billing.startTrial(company.id, { trialDays });

        return { kind: "created" as const, company };
      });

      // Post-transaction: handle existing vs created, log activity
      if (result.kind === "existing") {
        logger.info(
          { userId, companyId: result.companyId },
          "Registration skipped — user already has a company",
        );
        const existing = await db
          .select({ id: companiesTable.id, name: companiesTable.name })
          .from(companiesTable)
          .where(eq(companiesTable.id, result.companyId))
          .then((r) => r[0] ?? null);
        res.json({
          companyId: existing?.id ?? result.companyId,
          companyName: existing?.name ?? "My Company",
          created: false,
        });
        return;
      }

      // Log activity outside the transaction
      await logActivity(db, {
        companyId: result.company.id,
        actorType: "user",
        actorId: userId,
        action: "company.created",
        entityType: "company",
        entityId: result.company.id,
        details: { name: result.company.name, source: "self_serve_registration" },
      });

      logger.info(
        { companyId: result.company.id, userId },
        "Self-serve registration complete",
      );

      res.status(201).json({
        companyId: result.company.id,
        companyName: result.company.name,
        companyPrefix: result.company.issuePrefix,
        created: true,
      });
    },
  );

  return router;
}