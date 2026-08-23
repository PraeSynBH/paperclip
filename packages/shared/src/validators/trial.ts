import { z } from "zod";
import { BILLING_PERIODS } from "../constants.js";

/**
 * Schema for starting a self-serve trial.
 * The tier is determined server-side (always the Trial tier).
 * The billingPeriod defaults to monthly.
 */
export const startTrialSchema = z.object({
  billingPeriod: z.enum(BILLING_PERIODS).default("monthly"),
});

export type StartTrialInput = z.infer<typeof startTrialSchema>;

/**
 * Schema for converting a trial to a paid subscription.
 * Currently delegates to createCheckoutSessionSchema fields.
 */
export const convertTrialSchema = z.object({
  tierId: z.string().uuid(),
  billingPeriod: z.enum(BILLING_PERIODS).default("monthly"),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export type ConvertTrialInput = z.infer<typeof convertTrialSchema>;

export type TrialStatusResponse = {
  isTrialing: boolean;
  trialEnd: string | null;
  tierId: string | null;
  tierName: string | null;
  daysRemaining: number | null;
  status: string | null;
};