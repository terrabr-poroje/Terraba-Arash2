/**
 * Client-side helper for invoking the sms.ir OTP and Cloudflare D1 registration endpoints
 */
import { toPersianErrorMessage } from "./error-messages";

export interface VerifyOtpParams {
  mobile: string;
  code: string;
  fullName?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export interface VerifyOtpResponse {
  success: boolean;
  message: string;
  user?: {
    id: string;
    phone: string;
    full_name: string;
    role: string;
    city: string;
    province: string;
    email?: string;
  };
  member?: {
    id: string;
    auth_user_id: string;
    full_name: string;
    phone: string;
    role: string;
    city: string;
    province: string;
  };
  roles?: string[];
  sessionToken?: string;
}

export async function requestSmsOtp(mobile: string): Promise<{ success: boolean; message: string }> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 15000) : null;
  try {
    const res = await fetch("/api/sms/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mobile }),
      keepalive: true,
      signal: controller?.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    const success = Boolean(res.ok && data.success);
    return {
      success,
      message: success
        ? data.message || "کد یک‌بارمصرف پیامک شد."
        : toPersianErrorMessage(data.message, "خطا در ارسال پیامک تأیید. لطفاً دوباره تلاش کنید."),
    };
  } catch (err) {
    console.error("[requestSmsOtp error]", err);
    return {
      success: false,
      message: toPersianErrorMessage(
        err,
        "خطا در اتصال به سرور جهت ارسال پیامک. لطفاً دوباره تلاش کنید.",
      ),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function submitVerifySmsOtp(
  params: string | VerifyOtpParams,
  optionalCode?: string,
): Promise<VerifyOtpResponse> {
  const payload: VerifyOtpParams =
    typeof params === "string"
      ? { mobile: params, code: optionalCode || "" }
      : params;

  try {
    const res = await fetch("/api/sms/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as VerifyOtpResponse;

    if (data.success && data.sessionToken && typeof window !== "undefined") {
      // Save D1 session in localStorage and cookie
      const sessionData = {
        token: data.sessionToken,
        user: data.user,
        member: data.member,
        roles: data.roles || ["buyer"],
      };
      localStorage.setItem("terrabar_d1_session", JSON.stringify(sessionData));
      document.cookie = `tb_session=${data.sessionToken}; path=/; max-age=2592000; SameSite=Lax`;
      window.dispatchEvent(new CustomEvent("terrabar-auth-change", { detail: sessionData }));
    }

    const success = Boolean(res.ok && data.success);
    return {
      success,
      message: success
        ? data.message || "ورود با موفقیت انجام شد."
        : toPersianErrorMessage(data.message, "کد نامعتبر است یا ورود انجام نشد."),
      user: data.user,
      member: data.member,
      roles: data.roles,
      sessionToken: data.sessionToken,
    };
  } catch (err) {
    console.error("[submitVerifySmsOtp error]", err);
    return {
      success: false,
      message: toPersianErrorMessage(err, "خطا در ارتباط با سرور جهت تأیید کد و ثبت‌نام."),
    };
  }
}
