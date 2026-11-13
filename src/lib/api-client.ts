/* eslint-disable @typescript-eslint/no-explicit-any */

export function getSessionToken(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem("terrabar_d1_session");
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return parsed?.token || "";
  } catch {
    return "";
  }
}

export function saveStoredSession(session: any): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem("terrabar_d1_session", JSON.stringify(session));
  document.cookie = `tb_session=${encodeURIComponent(session.token)}; Path=/; Max-Age=2592000; SameSite=Lax`;
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

    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.warn("[apiFetch] network error:", path, err);
    return {
      ok: false,
      status: 0,
      data: { success: false, message: "خطا در برقراری ارتباط با سرور. لطفاً دوباره تلاش کنید." } as T,
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
