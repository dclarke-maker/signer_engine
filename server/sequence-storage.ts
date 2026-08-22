import { Client } from "minio";

const bucketName = process.env.OBJECT_STORAGE_BUCKET ?? "signbridge-sequences";
const region = process.env.OBJECT_STORAGE_REGION ?? "us-east-1";

function isHetzner() {
  return process.env.OBJECT_STORAGE_MODE === "hetzner";
}

/**
 * Fails fast in production rather than surfacing a misconfiguration as a
 * mysterious upload error. Buckets are private and credentials are server-side
 * only; the client receives neither.
 */
export function assertStorageConfig() {
  if (!isHetzner()) return;
  const required = [
    "OBJECT_STORAGE_ENDPOINT",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY",
    "OBJECT_STORAGE_SECRET_KEY",
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Object storage is not configured: missing ${missing.join(", ")}`);
  }
}

function createClient() {
  const endpoint = new URL(process.env.OBJECT_STORAGE_ENDPOINT ?? "http://minio:9000");
  return new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "signbridge-local",
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "signbridge-local-secret",
    region,
  });
}

export function sequenceObjectKey(input: { signerId: number; sessionId: string }) {
  return `sequences/signer-${input.signerId}/${input.sessionId}.json.gz`;
}

/**
 * The single storage boundary for landmark sequences. Docker development targets
 * MinIO; production targets a private Hetzner Object Storage bucket. No video
 * passes through here - see design.md §3.3 for the one flag-gated exception.
 */
export async function putLandmarkSequence(input: { key: string; data: Uint8Array }) {
  assertStorageConfig();
  const client = createClient();

  // In production the bucket is provisioned out of band; auto-creating it would
  // mask a credential or naming error rather than surfacing it.
  if (!isHetzner() && !(await client.bucketExists(bucketName))) {
    await client.makeBucket(bucketName, region);
  }

  await client.putObject(bucketName, input.key, Buffer.from(input.data), input.data.byteLength, {
    "Content-Type": "application/gzip",
  });

  return {
    bucket: bucketName,
    key: input.key,
    sizeBytes: input.data.byteLength,
    storageDriver: isHetzner() ? "hetzner-object-storage" : "minio",
  } as const;
}

export async function getLandmarkSequenceUrl(key: string, ttlSeconds = 300) {
  assertStorageConfig();
  return createClient().presignedGetObject(bucketName, key, ttlSeconds);
}
