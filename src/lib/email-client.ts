/**
 * Client-side helpers for Email OTP authentication and Password Reset via Resend
 */

import type { AppUser, AppMember } from "./auth";

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

/**
 * Requests a 6-digit OTP code to be sent to the user's email via Resend
 */
export async function requestEmailOtp(
  email: string,
  purpose: "signup" | "login" | "reset_password" = "signup"
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch("/api/email/send-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, purpose }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    return {
      success: !!data.success,
      message: data.message || (res.ok ? "کد تأیید به نشانی ایمیل شما ارسال شد." : "خطا در ارسال ایمیل"),
    };
  } catch (err) {
    console.error("[requestEmailOtp error]", err);
    return {
      success: false,
      message: "خطا در اتصال به سرور جهت ارسال کد به ایمیل. لطفاً اتصال اینترنت خود را بررسی کنید.",
    };
  }
}

/**
 * Submits the email OTP verification code and logs in / registers the user
 */
export async function submitVerifyEmailOtp(
  params: VerifyEmailOtpParams
): Promise<VerifyEmailOtpResponse> {
  try {
    const res = await fetch("/api/email/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(12000),
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

    return {
      success: !!data.success,
      message: data.message || (res.ok ? "ورود با موفقیت انجام شد." : "کد تأیید نامعتبر است."),
      user: data.user,
      member: data.member,
      roles: data.roles,
      sessionToken: data.sessionToken,
    };
  } catch (err) {
    console.error("[submitVerifyEmailOtp error]", err);
    return {
      success: false,
      message: "خطا در برقراری ارتباط با سرور برای تأیید کد و ورود.",
    };
  }
}

/**
 * Requests password reset OTP via SMS or Email
 */
export async function requestPasswordReset(
  identifier: string,
  preferredMethod?: "sms" | "email"
): Promise<{ success: boolean; message: string; deliveryMethod?: string; target?: string }> {
  try {
    const res = await fetch("/api/auth/send-password-reset-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, preferredMethod }),
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      deliveryMethod?: string;
      target?: string;
    };
    return {
      success: !!data.success,
      message: data.message || (res.ok ? "کد بازیابی ارسال شد." : "خطا در ارسال کد"),
      deliveryMethod: data.deliveryMethod,
      target: data.target,
    };
  } catch (err) {
    console.error("[requestPasswordReset error]", err);
    return {
      success: false,
      message: "خطا در اتصال به سرور جهت درخواست بازیابی رمز عبور.",
    };
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
  try {
    const res = await fetch("/api/auth/reset-password-with-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(12000),
    });
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; message?: string };
    return {
      success: !!data.success,
      message: data.message || (res.ok ? "رمز عبور با موفقیت به‌روزرسانی شد." : "خطا در ثبت رمز عبور جدید"),
    };
  } catch (err) {
    console.error("[submitResetPasswordWithOtp error]", err);
    return {
      success: false,
      message: "خطا در ارتباط با سرور جهت تغییر رمز عبور.",
    };
  }
}
