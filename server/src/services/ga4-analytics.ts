import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { logger } from "../middleware/logger.js";

export interface Ga4Config {
  measurementId: string;
  apiSecret: string;
  enabled: boolean;
  debug: boolean;
  clientName: string;
}

export function resolveGa4ConfigFromEnv(): Ga4Config {
  return {
    measurementId: process.env.GA4_MEASUREMENT_ID ?? "",
    apiSecret: process.env.GA4_API_SECRET ?? "",
    enabled: process.env.GA4_ENABLED === "true",
    debug: process.env.GA4_DEBUG === "true",
    clientName: "paperclip-server",
  };
}

export interface Ga4Event {
  name: string;
  params?: Record<string, string | number | boolean | null | undefined>;
}

export interface Ga4Payload {
  client_id: string;
  user_id?: string;
  timestamp_micros?: string;
  non_personalized_ads?: boolean;
  events: Ga4Event[];
}

export interface Ga4AnalyticsService {
  send(payload: Ga4Payload): Promise<void>;
  event(name: string, params?: Ga4Event["params"], clientId?: string, userId?: string): Promise<void>;
  readonly enabled: boolean;
}

export function createGa4AnalyticsService(config?: Ga4Config): Ga4AnalyticsService {
  const cfg = config ?? resolveGa4ConfigFromEnv();
  const enabled = cfg.enabled && Boolean(cfg.measurementId) && Boolean(cfg.apiSecret);

  if (!cfg.enabled) {
    logger.info("GA4 analytics is disabled (GA4_ENABLED != true)");
  } else if (!cfg.measurementId || !cfg.apiSecret) {
    logger.warn(
      { hasMeasurementId: Boolean(cfg.measurementId), hasApiSecret: Boolean(cfg.apiSecret) },
      "GA4 analytics is enabled but missing measurement ID or API secret — events will be dropped",
    );
  }

  function buildUrl(): string {
    const base = cfg.debug
      ? "https://www.google-analytics.com/debug/mp/collect"
      : "https://www.google-analytics.com/mp/collect";
    const params = new URLSearchParams({ measurement_id: cfg.measurementId, api_secret: cfg.apiSecret });
    return `${base}?${params.toString()}`;
  }

  function postJson(url: string, body: unknown): Promise<void> {
    return new Promise((resolve) => {
      const parsedUrl = new URL(url);
      const requester = parsedUrl.protocol === "https:" ? httpsRequest : httpRequest;
      const payload = JSON.stringify(body);
      const req = requester(
        url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload).toString(),
            "User-Agent": cfg.clientName,
          },
          timeout: 5_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const statusCode = res.statusCode ?? 0;
            if (statusCode >= 200 && statusCode < 300) { resolve(); return; }
            const body = Buffer.concat(chunks).toString("utf8").trim();
            logger.warn({ statusCode, response: body }, `GA4 responded with ${statusCode}`);
            resolve();
          });
        },
      );
      req.on("error", (err: Error) => { logger.warn({ err: err.message }, "GA4 request failed"); resolve(); });
      req.on("timeout", () => { req.destroy(); logger.warn("GA4 request timed out after 5s"); resolve(); });
      req.write(payload);
      req.end();
    });
  }

  const service: Ga4AnalyticsService = {
    get enabled(): boolean { return enabled; },
    async send(payload: Ga4Payload): Promise<void> {
      if (!enabled) return;
      await postJson(buildUrl(), payload);
    },
    async event(name: string, params?: Ga4Event["params"], clientId = "paperclip-server", userId?: string): Promise<void> {
      if (!enabled) return;
      const payload: Ga4Payload = { client_id: clientId, events: [{ name, params: params ?? {} }] };
      if (userId) payload.user_id = userId;
      await service.send(payload);
    },
  };
  return service;
}

let sharedService: Ga4AnalyticsService | null = null;
export function getGa4AnalyticsService(): Ga4AnalyticsService {
  if (!sharedService) sharedService = createGa4AnalyticsService();
  return sharedService;
}

export const ga4AnalyticsService: Ga4AnalyticsService = getGa4AnalyticsService();

export function buildSignupEvent(userId: string, email?: string): Ga4Payload {
  return {
    client_id: userId, user_id: userId,
    events: [{ name: "signup", params: { method: "email", ...(email ? { email_domain: email.split("@")[1] } : {}) } }],
  };
}

export function buildApprovalEvent(approvalId: string, approvalType: string, companyId: string): Ga4Payload {
  return {
    client_id: `approval:${approvalId}`,
    events: [{ name: "approval", params: { approval_id: approvalId, approval_type: approvalType, company_id: companyId } }],
  };
}

export function buildApprovalRejectedEvent(approvalId: string, approvalType: string, companyId: string): Ga4Payload {
  return {
    client_id: `approval:${approvalId}`,
    events: [{ name: "approval_rejected", params: { approval_id: approvalId, approval_type: approvalType, company_id: companyId } }],
  };
}
