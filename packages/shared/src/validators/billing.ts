import { z } from "zod";
import { BILLING_PERIODS } from "../constants.js";

export const createSubscriptionSchema = z.object({
  tierId: z.string().uuid(),
  billingPeriod: z.enum(BILLING_PERIODS).default("monthly"),
});

export type CreateSubscription = z.infer<typeof createSubscriptionSchema>;

export const createCheckoutSessionSchema = z.object({
  tierId: z.string().uuid(),
  billingPeriod: z.enum(BILLING_PERIODS).default("monthly"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export type CreateCheckoutSession = z.infer<typeof createCheckoutSessionSchema>;

export const updateSubscriptionSchema = z.object({
  tierId: z.string().uuid(),
  billingPeriod: z.enum(BILLING_PERIODS).optional(),
});

export type UpdateSubscription = z.infer<typeof updateSubscriptionSchema>;

export const reportUsageSchema = z.object({
  metric: z.enum(["seats", "agent_runs", "storage_gb"]),
  quantity: z.number().int().nonnegative(),
});

export type ReportUsage = z.infer<typeof reportUsageSchema>;

/**
 * Schema for the self-serve registration flow.
 * Submitted after better-auth creates the user session.
 */
export const completeRegistrationSchema = z.object({
  companyName: z.string().min(1).max(100).optional(),
  trialDays: z.number().int().min(1).max(90).optional(),
});

export type CompleteRegistration = z.infer<typeof completeRegistrationSchema>;

export const createPortalSessionSchema = z.object({
  returnUrl: z.string().url().max(2048).optional(),
});

export type CreatePortalSession = z.infer<typeof createPortalSessionSchema>;
