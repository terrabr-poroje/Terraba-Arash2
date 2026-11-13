/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getEnvVar } from "./runtime-env";

const globalForS3 = globalThis as unknown as {
  __terrabar_parspack_s3__?: S3Client;
  __terrabar_parspack_sig__?: string;
};

function getParsPackConfig() {
  const endpoint = getEnvVar("PARSPACK_STORAGE_ENDPOINT");
  const accessKeyId = getEnvVar("PARSPACK_STORAGE_ACCESS_KEY");
  const secretAccessKey = getEnvVar("PARSPACK_STORAGE_SECRET_KEY");
  const bucket = getEnvVar("PARSPACK_STORAGE_BUCKET");
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

export function getParsPackS3Client(): { client: S3Client; bucket: string } {
  const { endpoint, accessKeyId, secretAccessKey, bucket } = getParsPackConfig();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error(
      "تنظیمات فضای ذخیره‌سازی ابری پارس‌پک (PARSPACK_STORAGE_*) در متغیرهای محیطی سرور تعریف نشده است.",
    );
  }

  const sig = `${endpoint}|${accessKeyId}|${bucket}`;
  if (globalForS3.__terrabar_parspack_s3__ && globalForS3.__terrabar_parspack_sig__ === sig) {
    return { client: globalForS3.__terrabar_parspack_s3__, bucket };
  }

  const client = new S3Client({
    region: "default",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  globalForS3.__terrabar_parspack_s3__ = client;
  globalForS3.__terrabar_parspack_sig__ = sig;
  return { client, bucket };
}

export function cleanStorageKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\.+/g, ".");
}

export async function uploadToParsPack(
  key: string,
  body: Uint8Array | Buffer | string,
  contentType = "image/webp",
): Promise<{ key: string; url: string; success: boolean }> {
  const { client, bucket } = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: cleanKey,
    Body: body,
    ContentType: contentType,
  });

  await client.send(command);

  return {
    key: cleanKey,
    url: `/api/storage/file/${cleanKey}`,
    success: true,
  };
}

export async function deleteFromParsPack(key: string): Promise<{ success: boolean; message: string }> {
  const { client, bucket } = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: cleanKey,
  });

  await client.send(command);

  return {
    success: true,
    message: "فایل با موفقیت از فضای ابری پارس‌پک حذف شد.",
  };
}

export async function getFileFromParsPack(key: string): Promise<{
  stream: any;
  contentType: string;
  contentLength?: number;
} | null> {
  const { client, bucket } = getParsPackS3Client();
  const cleanKey = cleanStorageKey(key);

  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    });

    const response = await client.send(command);
    return {
      stream: response.Body,
      contentType: response.ContentType || "image/webp",
      contentLength: response.ContentLength,
    };
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error("[getFileFromParsPack error]", cleanKey, err);
    throw err;
  }
}

export async function listParsPackFiles(
  prefix = "",
): Promise<Array<{ key: string; size?: number; lastModified?: Date }>> {
  const { client, bucket } = getParsPackS3Client();
  const command = new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix ? cleanStorageKey(prefix) : undefined,
  });

  const response = await client.send(command);
  return (response.Contents || []).map((item) => ({
    key: item.Key || "",
    size: item.Size,
    lastModified: item.LastModified,
  }));
}
