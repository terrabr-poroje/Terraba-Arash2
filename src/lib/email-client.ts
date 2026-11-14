/**
 * Client-side helpers for Email OTP authentication and Password Reset via Resend
 */

import type { AppUser, AppMember } from "./auth";
import { toPersianErrorMessage } from "./error-messages";

export interface VerifyEmailOtpParams {
  email: string;
  code: string;
  fullName?: string;
  city?: string;
  province?: string;
  role?: string;
  activity?: string;
  mode?: "login" | "signup";
}

export interface VerifyEmailOtpResponse {
  success: boolean;
  message: string;
  user?: AppUser;
  member?: AppMember;
  roles?: string[];
  sessionToken?: string;
}

function createTimeoutSignal(ms: number): { signal?: AbortSignal; cleanup: () => void } {
  if (typeof AbortController === "undefined") {
    return { cleanup: () => {} };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Requests a 6-digit OTP code to be sent to the user's email via Resend
 */
export async function requestEmailOtp(
  email: string,
  purpose: "signup" | "login" | "reset_password" = "signup"
): Promise<{ success: boolean; message: string }> {
  const timeout = createTimeoutSignal(20000);
  try {
    const res = await fetch("/api/email/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose }),
      signal: timeout.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    const success = Boolean(res.ok && data.success);
    return {
      success,
      message: success
        ? data.message || "کد تأیید به نشانی ایمیل شما ارسال شد."
        : toPersianErrorMessage(data.message, "خطا در ارسال ایمیل تأیید. لطفاً دوباره تلاش کنید."),
    };
  } catch (err) {
    console.error("[requestEmailOtp error]", err);
    return {
      success: false,
      message: isAbortError(err)
        ? "پاسخ‌گویی سرور ایمیل طولانی شد. لطفاً چند لحظه بعد دوباره تلاش کنید."
        : toPersianErrorMessage(err, "خطا در برقراری ارتباط با سرور ایمیل. لطفاً دوباره تلاش کنید."),
    };
  } finally {
    timeout.cleanup();
  }
}

/**
 * Submits the email OTP verification code and logs in / registers the user
 */
export async function submitVerifyEmailOtp(
  params: VerifyEmailOtpParams
): Promise<VerifyEmailOtpResponse> {
  const timeout = createTimeoutSignal(20000);
  try {
    const res = await fetch("/api/email/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: timeout.signal,
    });
    const data = (await res.json().catch(() => ({}))) as VerifyEmailOtpResponse;

    if (data.success && data.sessionToken && typeof window !== "undefined") {
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
        : toPersianErrorMessage(data.message, "کد تأیید نامعتبر است یا ورود انجام نشد."),
      user: data.user,
      member: data.member,
      roles: data.roles,
      sessionToken: data.sessionToken,
    };
  } catch (err) {
    console.error("[submitVerifyEmailOtp error]", err);
    return {
      success: false,
      message: isAbortError(err)
        ? "پاسخ‌گویی سرور طولانی شد. لطفاً دوباره تلاش کنید."
        : toPersianErrorMessage(err, "خطا در برقراری ارتباط با سرور برای تأیید کد و ورود."),
    };
  } finally {
    timeout.cleanup();
  }
}

/**
 * Requests password reset OTP via SMS or Email
 */
export async function requestPasswordReset(
  identifier: string,
  preferredMethod?: "sms" | "email"
): Promise<{ success: boolean; message: string; deliveryMethod?: string; target?: string }> {
  const timeout = createTimeoutSignal(20000);
  try {
    const res = await fetch("/api/auth/send-password-reset-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, preferredMethod }),
      signal: timeout.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      deliveryMethod?: string;
      target?: string;
    };
    const success = Boolean(res.ok && data.success);
    return {
      success,
      message: success
        ? data.message || "کد بازیابی ارسال شد."
        : toPersianErrorMessage(data.message, "خطا در ارسال کد بازیابی."),
      deliveryMethod: data.deliveryMethod,
      target: data.target,
    };
  } catch (err) {
    console.error("[requestPasswordReset error]", err);
    return {
      success: false,
      message: toPersianErrorMessage(err, "خطا در اتصال به سرور جهت درخواست بازیابی رمز عبور."),
    };
  } finally {
    timeout.cleanup();
  }
}

/**
 * Resets user password using the OTP code received via SMS or Email
 */
export async function submitResetPasswordWithOtp(params: {
  identifier: string;
  code: string;
  newPassword: string;
}): Promise<{ success: boolean; message: string }> {
  const timeout = createTimeoutSignal(20000);
  try {
    const res = await fetch("/api/auth/reset-password-with-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: timeout.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    const success = Boolean(res.ok && data.success);
    return {
      success,
      message: success
        ? data.message || "رمز عبور با موفقیت به‌روزرسانی شد."
        : toPersianErrorMessage(data.message, "خطا در ثبت رمز عبور جدید."),
    };
  } catch (err) {
    console.error("[submitResetPasswordWithOtp error]", err);
    return {
      success: false,
      message: toPersianErrorMessage(err, "خطا در ارتباط با سرور جهت تغییر رمز عبور."),
    };
  } finally {
    timeout.cleanup();
  }
}
