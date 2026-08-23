import { Router } from "express";
import { eq } from "drizzle-orm";
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

      // Check if user already has a company — idempotent
      const existingCompanies = await db
        .select({ id: companiesTable.id, name: companiesTable.name })
        .from(companiesTable)
        .limit(1);

      if (existingCompanies.length > 0) {
        logger.info(
          { userId, companyId: existingCompanies[0].id },
          "Registration skipped — user already has a company",
        );
        res.json({
          companyId: existingCompanies[0].id,
          companyName: existingCompanies[0].name,
          created: false,
        });
        return;
      }

      const companyName = body.companyName?.trim() || "My Company";
      const companies = companyService(db);
      const access = accessService(db);

      // 1. Create the company
      const company = await companies.create({
        name: companyName,
        defaultResponsibleUserId: userId,
      });

      // 2. Ensure membership (owner)
      await access.ensureMembership(company.id, "user", userId, "owner", "active");
      await access.ensureRoleDefaultGrants(company.id, userId, "owner", userId);

      // 3. Start trial subscription
      const trialDays = body.trialDays ?? 14;
      try {
        const billing = billingService(db);
        await billing.startTrial(company.id, { trialDays });
        logger.info(
          { companyId: company.id, trialDays },
          "Trial started for new company",
        );
      } catch (err) {
        logger.warn(
          { err, companyId: company.id },
          "Failed to start trial (non-fatal)",
        );
      }

      // 4. Log activity
      await logActivity(db, {
        companyId: company.id,
        actorType: "user",
        actorId: userId,
        action: "company.created",
        entityType: "company",
        entityId: company.id,
        details: { name: company.name, source: "self_serve_registration" },
      });

      logger.info(
        { companyId: company.id, userId },
        "Self-serve registration complete",
      );

      res.status(201).json({
        companyId: company.id,
        companyName: company.name,
        companyPrefix: company.issuePrefix,
        created: true,
      });
    },
  );

  return router;
}
