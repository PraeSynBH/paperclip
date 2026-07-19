import "dotenv/config";
import { getSecretValue } from "./secrets/aws.js";

export interface GcpConfig {
  projectId: string;
  organizationId: string;
}

export interface AiraConfig {
  drata: {
    apiKey: string;
    baseUrl: string;
  };
  googleAi: {
    apiKey: string;
    baseUrl: string;
  };
  openrouter: {
    apiKey: string;
    baseUrl: string;
  };
  gcp: GcpConfig;
  dataDir: string;
  aws: {
    region: string;
    secretId: string;
  };
}

let cachedConfig: AiraConfig | null = null;

export async function loadConfig(): Promise<AiraConfig> {
  if (cachedConfig) return cachedConfig;

  const awsRegion = process.env.AWS_REGION ?? "us-east-1";
  const awsSecretId = process.env.AWS_SECRET_ID ?? "aira/secrets";

  const resolve = async (key: string, envVar: string, fallback: string): Promise<string> => {
    const fromSm = await getSecretValue(key, awsSecretId, { region: awsRegion }).catch(() => null);
    if (fromSm) return fromSm;
    return process.env[envVar] ?? fallback;
  };

  cachedConfig = {
    drata: {
      apiKey: await resolve("DRATA_API_KEY", "DRATA_API_KEY", ""),
      baseUrl: process.env.DRATA_BASE_URL ?? "https://public-api.drata.com/public/v2",
    },
    googleAi: {
      apiKey: await resolve("GEMINI_API_KEY", "GEMINI_API_KEY", ""),
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
    openrouter: {
      apiKey: await resolve("OPENROUTER_API_KEY", "OPENROUTER_API_KEY", ""),
      baseUrl: "https://openrouter.ai/api/v1",
    },
    gcp: {
      projectId: await resolve("GCP_PROJECT_ID", "GCP_PROJECT_ID", ""),
      organizationId: await resolve("GCP_ORGANIZATION_ID", "GCP_ORGANIZATION_ID", ""),
    },
    dataDir: process.env.DATA_DIR ?? "./data",
    aws: {
      region: awsRegion,
      secretId: awsSecretId,
    },
  };

  return cachedConfig;
}

export const config: AiraConfig = {
  drata: {
    apiKey: process.env.DRATA_API_KEY ?? "",
    baseUrl: process.env.DRATA_BASE_URL ?? "https://public-api.drata.com/public/v2",
  },
  googleAi: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY ?? "",
    baseUrl: "https://openrouter.ai/api/v1",
  },
  gcp: {
    projectId: process.env.GCP_PROJECT_ID ?? "",
    organizationId: process.env.GCP_ORGANIZATION_ID ?? "",
  },
  dataDir: process.env.DATA_DIR ?? "./data",
  aws: {
    region: process.env.AWS_REGION ?? "us-east-1",
    secretId: process.env.AWS_SECRET_ID ?? "aira/secrets",
  },
};

export async function assertConfig(): Promise<void> {
  const cfg = await loadConfig();
  if (!cfg.drata.apiKey) {
    throw new Error(
      "DRATA_API_KEY is required. Set it in AWS Secrets Manager (aira/secrets), " +
        "or as a DRATA_API_KEY environment variable in .env for local development.",
    );
  }
}

export function assertConfigSync(): void {
  if (!config.drata.apiKey) {
    throw new Error(
      "DRATA_API_KEY is required. Set it in DRATA_API_KEY environment variable (or .env) " +
        "for immediate startup. For production, use loadConfig() which checks AWS Secrets Manager first.",
    );
  }
}