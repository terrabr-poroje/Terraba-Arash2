/**
 * Service for sending and verifying OTP & transactional SMS via sms.ir REST API.
 * Uses environment variables exclusively (no hardcoded API keys) and persists OTPs
 * and delivery logs via D1 callbacks configured at runtime.
 */

import { getEnvVar } from "./runtime-env";

export type SmsLogPayload = {
  recipient: string;
  channel?: "sms" | "email";
  eventType: string;
  templateId?: string;
  messageSummary: string;
  status: "sent" | "failed";
  providerStatus?: string;
  errorMessage?: string;
  relatedId?: string;
};

type OtpPersistenceHook = {
  saveOtp: (target: string, channel: "sms" | "email", code: string, expiresAt: number) => Promise<void>;
  verifyOtp: (
    target: string,
    code: string,
  ) => Promise<{ success: boolean; message: string }>;
  logMessage?: (entry: SmsLogPayload) => Promise<void>;
};

const globalForOtp = globalThis as unknown as {
  __terrabar_otp_store__?: Map<string, { code: string; expiresAt: number; attempts: number }>;
  __terrabar_otp_hook__?: OtpPersistenceHook;
};

export const otpStore =
  globalForOtp.__terrabar_otp_store__ ||
  new Map<string, { code: string; expiresAt: number; attempts: number }>();
globalForOtp.__terrabar_otp_store__ = otpStore;

export function registerOtpPersistenceHook(hook: OtpPersistenceHook): void {
  globalForOtp.__terrabar_otp_hook__ = hook;
}

async function recordSmsLog(entry: SmsLogPayload): Promise<void> {
  try {
    await globalForOtp.__terrabar_otp_hook__?.logMessage?.(entry);
  } catch (err) {
    console.warn("[sms-service] Failed to persist SMS log:", err);
  }
}

export function toAsciiDigits(value: string): string {
  return (value || "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizeIranMobile(value: string): string {
  const digits = toAsciiDigits(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("0098")) return "0" + digits.slice(4);
  if (digits.startsWith("98") && digits.length >= 12) return "0" + digits.slice(2);
  if (digits.startsWith("9") && digits.length === 10) return "0" + digits;
  if (digits.startsWith("09")) return digits;
  return digits;
}

export function generateOtpCode(): string {
  const randomBuffer = new Uint32Array(1);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(randomBuffer);
    return String(100000 + (randomBuffer[0] % 900000));
  }
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendToSmsIrVerify(
  mobile: string,
  templateId: number,
  code: string,
): Promise<{ ok: boolean; status?: number; message?: string }> {
  const apiKey = getEnvVar("SMS_IR_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      message: "کلید وب‌سرویس پیامک (SMS_IR_API_KEY) در تنظیمات محیطی سرور تعریف نشده است.",
    };
  }

  try {
    const payload = {
      mobile,
      templateId,
      parameters: [
        { name: "Code", value: code },
        { name: "OTP", value: code },
        { name: "code", value: code },
      ],
    };

    const response = await fetch("https://api.sms.ir/v1/send/verify", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    const result = (await response.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
      data?: { messageId?: number; cost?: number };
    };

    const isSuccess =
      response.ok &&
      (result.status === 1 ||
        result.status === 200 ||
        result.status === 0 ||
        typeof result.data?.messageId !== "undefined");

    return {
      ok: isSuccess,
      status: result.status,
      message: result.message,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: isTimeout ? "مهلت زمانی ارتباط با سرویس پیامک به پایان رسید." : errorMsg,
    };
  }
}

let primaryTemplateStatus: "unknown" | "active" | "not_found" = "unknown";
let lastPrimaryCheckTime = 0;

export async function sendOtpSms(
  rawMobile: string,
  eventType = "auth_otp",
): Promise<{ success: boolean; message: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return {
      success: false,
      message: "شماره موبایل وارد شده معتبر نیست. لطفاً یک شماره ۱۱ رقمی (مثال: ۰۹۱۲۳۴۵۶۷۸۹) وارد کنید.",
    };
  }

  const primaryTemplateId = Number(getEnvVar("SMS_IR_TEMPLATE_ID", "582256")) || 582256;
  const fallbackTemplateId = Number(getEnvVar("SMS_IR_FALLBACK_TEMPLATE_ID", "888217")) || 888217;

  const code = generateOtpCode();
  const now = Date.now();
  const expiresAt = now + 10 * 60 * 1000;

  otpStore.set(mobile, { code, expiresAt, attempts: 0 });
  if (globalForOtp.__terrabar_otp_hook__?.saveOtp) {
    await globalForOtp.__terrabar_otp_hook__.saveOtp(mobile, "sms", code, expiresAt);
  }

  const isPrimaryKnownNotFound =
    primaryTemplateStatus === "not_found" && now - lastPrimaryCheckTime < 10 * 60 * 1000;

  let usedTemplate = primaryTemplateId;
  let dispatchResult: { ok: boolean; status?: number; message?: string };

  if (isPrimaryKnownNotFound && primaryTemplateId !== fallbackTemplateId) {
    usedTemplate = fallbackTemplateId;
    dispatchResult = await sendToSmsIrVerify(mobile, fallbackTemplateId, code);
  } else {
    dispatchResult = await sendToSmsIrVerify(mobile, primaryTemplateId, code);
    if (dispatchResult.ok) {
      primaryTemplateStatus = "active";
    } else {
      if (dispatchResult.status === 113) {
        primaryTemplateStatus = "not_found";
        lastPrimaryCheckTime = now;
      }
      if (primaryTemplateId !== fallbackTemplateId) {
        usedTemplate = fallbackTemplateId;
        dispatchResult = await sendToSmsIrVerify(mobile, fallbackTemplateId, code);
      }
    }
  }

  await recordSmsLog({
    recipient: mobile,
    channel: "sms",
    eventType,
    templateId: String(usedTemplate),
    messageSummary: "ارسال کد تأیید ۶ رقمی یک‌بارمصرف",
    status: dispatchResult.ok ? "sent" : "failed",
    providerStatus: typeof dispatchResult.status !== "undefined" ? String(dispatchResult.status) : undefined,
    errorMessage: dispatchResult.ok ? undefined : dispatchResult.message,
  });

  if (!dispatchResult.ok) {
    return {
      success: false,
      message: dispatchResult.message || "خطا در ارسال پیامک تأیید. لطفاً تنظیمات سرویس پیامکی را بررسی کنید.",
    };
  }

  return {
    success: true,
    message: "کد تأیید ۶ رقمی با موفقیت به شماره موبایل شما پیامک شد.",
  };
}

export async function verifyOtpCode(
  rawMobile: string,
  inputCode: string,
): Promise<{ success: boolean; message: string }> {
  const mobile = normalizeIranMobile(rawMobile);
  const cleanCode = toAsciiDigits(inputCode || "").trim();

  if (!/^09\d{9}$/.test(mobile) || !/^\d{5,6}$/.test(cleanCode)) {
    return { success: false, message: "شماره موبایل یا کد تأیید نامعتبر است." };
  }

  if (globalForOtp.__terrabar_otp_hook__?.verifyOtp) {
    return globalForOtp.__terrabar_otp_hook__.verifyOtp(mobile, cleanCode);
  }

  const stored = otpStore.get(mobile);
  if (!stored) {
    return {
      success: false,
      message: "کد تأییدی برای این شماره ثبت نشده یا منقضی شده است. لطفاً مجدداً درخواست کد کنید.",
    };
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(mobile);
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید دریافت کنید." };
  }

  stored.attempts += 1;
  if (stored.attempts > 5) {
    otpStore.delete(mobile);
    return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز بود. کد جدید درخواست دهید." };
  }

  if (stored.code !== cleanCode) {
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  otpStore.delete(mobile);
  return { success: true, message: "کد تأیید با موفقیت احراز شد." };
}

/**
 * Dispatches transactional SMS notifications (order created, status updated, finance payout, approval)
 * and always records an entry in sms_logs.
 */
export async function sendEventNotificationSms(params: {
  mobile: string;
  eventType:
    | "order_created_buyer"
    | "order_created_seller"
    | "order_status_updated"
    | "payout_requested"
    | "payout_paid"
    | "role_approved"
    | "role_rejected";
  messageText: string;
  relatedId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const mobile = normalizeIranMobile(params.mobile);
  if (!/^09\d{9}$/.test(mobile)) {
    return { ok: false, error: "شماره موبایل معتبر نیست." };
  }

  const apiKey = getEnvVar("SMS_IR_API_KEY");
  const lineNumber = getEnvVar("SMS_IR_LINE_NUMBER");

  if (!apiKey) {
    const errMsg = "کلید سرویس پیامکی (SMS_IR_API_KEY) پیکربندی نشده است.";
    await recordSmsLog({
      recipient: mobile,
      channel: "sms",
      eventType: params.eventType,
      messageSummary: params.messageText,
      status: "failed",
      errorMessage: errMsg,
      relatedId: params.relatedId,
    });
    return { ok: false, error: errMsg };
  }

  if (!lineNumber) {
    const errMsg = "شماره خط ارسال پیامک (SMS_IR_LINE_NUMBER) پیکربندی نشده است؛ پیامک در گزارش ثبت شد.";
    await recordSmsLog({
      recipient: mobile,
      channel: "sms",
      eventType: params.eventType,
      messageSummary: params.messageText,
      status: "failed",
      errorMessage: errMsg,
      relatedId: params.relatedId,
    });
    return { ok: false, error: errMsg };
  }

  try {
    const response = await fetch("https://api.sms.ir/v1/send/bulk", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        lineNumber: Number(lineNumber) || lineNumber,
        messageText: params.messageText,
        mobiles: [mobile],
      }),
      signal: AbortSignal.timeout(5000),
    });

    const result = (await response.json().catch(() => ({}))) as {
      status?: number;
      message?: string;
    };

    const ok = response.ok && (result.status === 1 || result.status === 200 || result.status === 0);

    await recordSmsLog({
      recipient: mobile,
      channel: "sms",
      eventType: params.eventType,
      messageSummary: params.messageText,
      status: ok ? "sent" : "failed",
      providerStatus: typeof result.status !== "undefined" ? String(result.status) : String(response.status),
      errorMessage: ok ? undefined : result.message || `HTTP ${response.status}`,
      relatedId: params.relatedId,
    });

    return ok ? { ok: true } : { ok: false, error: result.message };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await recordSmsLog({
      recipient: mobile,
      channel: "sms",
      eventType: params.eventType,
      messageSummary: params.messageText,
      status: "failed",
      errorMessage: errMsg,
      relatedId: params.relatedId,
    });
    return { ok: false, error: errMsg };
  }
}
