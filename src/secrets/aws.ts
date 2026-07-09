import {
  SecretsManagerClient,
  GetSecretValueCommand,
  ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

interface SecretCacheEntry {
  value: string;
  fetchedAt: number;
}

export interface SecretsManagerConfig {
  region?: string;
  secretId?: string;
  cacheTtlMs?: number;
}

const DEFAULT_REGION = "us-east-1";
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

let client: SecretsManagerClient | null = null;

function getClient(region?: string): SecretsManagerClient {
  if (!client) {
    client = new SecretsManagerClient({
      region: region ?? process.env.AWS_REGION ?? DEFAULT_REGION,
    });
  }
  return client;
}

const cache = new Map<string, SecretCacheEntry>();

export async function getSecret(
  secretId: string,
  config?: SecretsManagerConfig,
): Promise<string | null> {
  const ttl = config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const cached = cache.get(secretId);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.value;
  }

  try {
    const smClient = getClient(config?.region);
    const command = new GetSecretValueCommand({ SecretId: secretId });
    const response = await smClient.send(command);

    const value = response.SecretString ?? null;
    if (value) {
      cache.set(secretId, { value, fetchedAt: Date.now() });
    }
    return value;
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      return null;
    }
    throw err;
  }
}

const JSON_SECRET_CACHE = new Map<string, { value: Record<string, string>; fetchedAt: number }>();

export async function getJsonSecret(
  secretId: string,
  config?: SecretsManagerConfig,
): Promise<Record<string, string> | null> {
  const ttl = config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

  const cached = JSON_SECRET_CACHE.get(secretId);
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return cached.value;
  }

  const raw = await getSecret(secretId, config);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    JSON_SECRET_CACHE.set(secretId, { value: parsed, fetchedAt: Date.now() });
    return parsed;
  } catch {
    return { value: raw };
  }
}

export async function getSecretValue(
  secretKey: string,
  secretsManagerSecretId?: string,
  config?: SecretsManagerConfig,
): Promise<string | null> {
  const secretId = secretsManagerSecretId ?? process.env.AWS_SECRET_ID ?? "aira/secrets";

  const jsonSecret = await getJsonSecret(secretId, config);
  if (jsonSecret && jsonSecret[secretKey]) {
    return jsonSecret[secretKey];
  }

  const singleSecret = await getSecret(`${secretId}/${secretKey}`, config);
  return singleSecret;
}

export function clearSecretCache(): void {
  cache.clear();
  JSON_SECRET_CACHE.clear();
}