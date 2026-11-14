/* eslint-disable @typescript-eslint/no-explicit-any */
import { toPersianErrorMessage } from "./error-messages";
import { safeStorage } from "./safe-storage";

export function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = safeStorage.getItem("terrabar_d1_session");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.token || "";
  } catch {
    return "";
  }
}

export function saveStoredSession(session: any): void {
  if (typeof window === "undefined") return;
  safeStorage.setItem("terrabar_d1_session", JSON.stringify(session));
  try {
    document.cookie = `tb_session=${encodeURIComponent(session.token)}; Path=/; Max-Age=2592000; SameSite=Lax`;
  } catch {
    // Restricted cookie context
  }
  window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: session }));
}

export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const token = getSessionToken();
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };

  if (token && !headers.Authorization) {
    headers.Authorization = `Bearer ${token}`;
  }

  let bodyPayload: BodyInit | undefined;
  if (options.body !== undefined) {
    if (options.body instanceof FormData || typeof options.body === "string") {
      bodyPayload = options.body;
    } else {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      bodyPayload = JSON.stringify(options.body);
    }
  }

  try {
    const res = await fetch(path, {
      method: options.method || "GET",
      headers,
      body: bodyPayload,
      credentials: "same-origin",
      cache: "no-store",
    });

    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || data?.success === false) {
      const normalizedMsg = toPersianErrorMessage(
        data?.message || data?.error,
        res.status === 403
          ? "شما دسترسی مجاز برای انجام این عملیات را ندارید."
          : res.status === 401
            ? "نشست کاربری شما منقضی شده است. لطفاً مجدداً وارد شوید."
            : res.status >= 500
              ? "خطای داخلی سرور در پردازش درخواست. لطفاً دوباره تلاش کنید."
              : "انجام درخواست با خطا مواجه شد. لطفاً دوباره تلاش کنید.",
      );
      if (data && typeof data === "object") {
        data.message = normalizedMsg;
        if (data.error) data.error = normalizedMsg;
      }
    }
    return { ok: res.ok, status: res.status, data: data as T };
  } catch (err) {
    console.warn("[apiFetch] network error:", path, err);
    return {
      ok: false,
      status: 0,
      data: {
        success: false,
        message: toPersianErrorMessage(err, "خطا در برقراری ارتباط با سرور. لطفاً دوباره تلاش کنید."),
      } as T,
    };
  }
}

export async function apiGet<T = any>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  return apiFetch<T>(path, { method: "GET" });
}

export async function apiPost<T = any>(path: string, body?: any): Promise<{ ok: boolean; status: number; data: T }> {
  return apiFetch<T>(path, { method: "POST", body });
}

export async function apiDelete<T = any>(path: string): Promise<{ ok: boolean; status: number; data: T }> {
  return apiFetch<T>(path, { method: "DELETE" });
}
