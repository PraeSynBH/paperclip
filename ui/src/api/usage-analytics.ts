import type { UsageAnalyticsResponse, UsageAnalyticsWindow } from "@paperclipai/shared";
import { api } from "./client";

export const usageAnalyticsApi = {
  report: (window: UsageAnalyticsWindow = "30d") =>
    api.get<UsageAnalyticsResponse>(`/instance/usage-analytics?window=${window}`),
};
