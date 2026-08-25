export {};

import type { AgentApiKeyScope } from "@paperclipai/shared";
import type { VoyonderAuth } from "../services/auth.js";

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
      /** Voyonder JWT auth — populated by assertVoyonderAuth() in standalone Voyonder deployment. */
      voyonderAuth?: VoyonderAuth;
    }
  }
}


