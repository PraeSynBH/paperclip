export {};

import type { AgentApiKeyScope } from "@paperclipai/shared";
import type { AuthContext, ClientCorrelationContext } from "../auth-context.js";

declare global {
  namespace Express {
    interface Request {
      actor: AuthContext;
      correlation?: ClientCorrelationContext;
    }
  }
}