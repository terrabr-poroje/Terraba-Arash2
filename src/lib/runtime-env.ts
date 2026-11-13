/* eslint-disable @typescript-eslint/no-explicit-any */

let runtimeWorkerEnv: Record<string, any> = {};

export function setRuntimeEnv(env: unknown): void {
  if (env && typeof env === "object") {
    runtimeWorkerEnv = env as Record<string, any>;
  }
}

export function getEnvVar(key: string, fallback = ""): string {
  const fromWorker = runtimeWorkerEnv?.[key];
  if (typeof fromWorker === "string" && fromWorker.length > 0) {
    return fromWorker;
  }
  if (typeof process !== "undefined" && process.env && typeof process.env[key] === "string") {
    return process.env[key] || fallback;
  }
  return fallback;
}
