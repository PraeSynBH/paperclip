export {};

import type { AgentApiKeyScope } from "@paperclipai/shared";

declare global {
  namespace Express {
    interface Request {
      actor: {
        type: "board" | "agent" | "none";
        userId?: string;
        userName?: string | null;
        userEmail?: string | null;
        agentId?: string;
        companyId?: string;
        companyIds?: string[];
        sessionId?: string | null;
        memberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        onBehalfOfMemberships?: Array<{
          companyId: string;
          membershipRole?: string | null;
          status?: string;
        }>;
        isInstanceAdmin?: boolean;
        keyId?: string;
        keyScope?: AgentApiKeyScope;
        runId?: string;
        onBehalfOfUserId?: string | null;
        source?: "local_implicit" | "session" | "board_key" | "agent_key" | "agent_jwt" | "cloud_tenant" | "none";
      };
    }
  }
}

/**
 * Minimal type declaration for @voyonder/product — an optional integration
 * with the Voyonder product repo. The package is not a workspace dependency;
 * the dynamic import in app.ts gracefully degrades when absent.
 */
declare module "@voyonder/product" {
  import type { Router as RouterType } from "express";
  import type { NodePgDatabase } from "drizzle-orm/pg-core";
  import type { EventBus, AuthProvider, LoggerProvider } from "@paperclipai/shared";

  export interface VoyonderOptions {
    eventBus: EventBus;
    authProvider: AuthProvider;
    logger?: LoggerProvider;
  }

  export function createVoyonderApp(
    db: NodePgDatabase,
    opts: VoyonderOptions,
  ): RouterType;
}
