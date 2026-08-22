import { Client } from "minio";

const bucketName = process.env.OBJECT_STORAGE_BUCKET ?? "signbridge-recordings";

function createClient() {
  const endpoint = new URL(process.env.OBJECT_STORAGE_ENDPOINT ?? "http://minio:9000");
  return new Client({
    endPoint: endpoint.hostname,
    port: Number(endpoint.port || (endpoint.protocol === "https:" ? 443 : 80)),
    useSSL: endpoint.protocol === "https:",
    accessKey: process.env.OBJECT_STORAGE_ACCESS_KEY ?? "signbridge-local",
    secretKey: process.env.OBJECT_STORAGE_SECRET_KEY ?? "signbridge-local-secret",
    region: process.env.OBJECT_STORAGE_REGION ?? "us-east-1",
  });
}

async function ensureBucket(client: Client) {
  const exists = await client.bucketExists(bucketName);
  if (!exists) {
    await client.makeBucket(bucketName, process.env.OBJECT_STORAGE_REGION ?? "us-east-1");
  }
}

/**
 * Single recording storage boundary. Docker development targets MinIO; production targets a private
 * Hetzner Object Storage bucket through its compatible object-storage interface.
 */
export async function putSignerRecording(input: { key: string; data: Uint8Array; contentType: string }) {
  const client = createClient();
  await ensureBucket(client);
  await client.putObject(
    bucketName,
    input.key,
    Buffer.from(input.data),
    input.data.byteLength,
    { "Content-Type": input.contentType },
  );

  return {
    bucket: bucketName,
    key: input.key,
    storageDriver: process.env.OBJECT_STORAGE_MODE === "hetzner" ? "hetzner-object-storage" : "minio",
  } as const;
}
