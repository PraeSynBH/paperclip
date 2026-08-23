import { z } from "zod";
import { AGENT_ROLES } from "../constants.js";

export const selectOnboardingRoleSchema = z.object({
  role: z.enum(AGENT_ROLES),
});

export type SelectOnboardingRoleInput = z.infer<typeof selectOnboardingRoleSchema>;

export const skipOnboardingSchema = z.object({}).optional();

export type OnboardingStatus = "pending" | "completed" | "skipped";

export type OnboardingStatusResponse = {
  status: OnboardingStatus;
  selectedRole: string | null;
  completedAt: string | null;
  canSelectRole: boolean;
};