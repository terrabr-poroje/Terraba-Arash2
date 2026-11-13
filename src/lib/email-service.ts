/**
 * Email Service using Resend REST API.
 * Uses environment variables exclusively and persists OTPs and logs via D1 hooks.
 */

import { getEnvVar } from "./runtime-env";
import { generateOtpCode, otpStore, toAsciiDigits, type SmsLogPayload } from "./sms-service";

type EmailPersistenceHook = {
  saveOtp: (target: string, channel: "sms" | "email", code: string, expiresAt: number) => Promise<void>;
  verifyOtp: (
    target: string,
    code: string,
  ) => Promise<{ success: boolean; message: string }>;
  logMessage?: (entry: SmsLogPayload) => Promise<void>;
};

const globalForEmailHook = globalThis as unknown as {
  __terrabar_email_hook__?: EmailPersistenceHook;
};

export function registerEmailPersistenceHook(hook: EmailPersistenceHook): void {
  globalForEmailHook.__terrabar_email_hook__ = hook;
}

export function normalizeEmail(value: string): string {
  return (value || "").trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  const email = normalizeEmail(value);
  return Boolean(email && email.includes("@") && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
}

function buildTerrabarEmailHtml(params: {
  title: string;
  bodyHeading: string;
  description: string;
  code?: string;
  expiresInMinutes?: number;
  detailsRows?: Array<{ label: string; value: string }>;
}): string {
  const { title, bodyHeading, description, code, expiresInMinutes = 10, detailsRows } = params;

  const codeBlock = code
    ? `<div style="margin: 24px 0; background-color: #f0f7f3; border: 2px dashed #1e704b; border-radius: 12px; padding: 20px; text-align: center;">
        <div style="font-size: 13px; color: #5a7366; margin-bottom: 8px;">کد تأیید یک‌بارمصرف شما</div>
        <div style="font-family: Courier, monospace; font-size: 34px; font-weight: 900; color: #1e704b; letter-spacing: 8px; direction: ltr;">${code}</div>
        <div style="margin-top: 8px; font-size: 12px; color: #1e704b; font-weight: bold;">اعتبار: ${expiresInMinutes} دقیقه</div>
      </div>`
    : "";

  const rowsBlock =
    detailsRows && detailsRows.length > 0
      ? `<div style="margin: 20px 0; background-color: #f8faf9; border: 1px solid #dbe4dd; border-radius: 10px; padding: 14px;">
          ${detailsRows
            .map(
              (r) =>
                `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eef2ef;font-size:13px;"><span style="color:#5a7366;">${r.label}:</span><strong style="color:#1c382b;">${r.value}</strong></div>`,
            )
            .join("")}
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;font-family:Tahoma,sans-serif;background-color:#f3f7f4;color:#1c382b;direction:rtl;text-align:right;">
  <div style="width:100%;background-color:#f3f7f4;padding:30px 15px;box-sizing:border-box;">
    <div style="max-width:520px;margin:0 auto;background-color:#ffffff;border-radius:16px;border:1px solid #dbe4dd;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#1e704b 0%,#193125 100%);padding:24px;text-align:center;color:#ffffff;">
        <h1 style="margin:0;font-size:22px;">ترابار</h1>
        <p style="margin:6px 0 0 0;font-size:12px;color:#e0eae2;">سامانه تخصصی بازار میوه و تره‌بار ایران</p>
      </div>
      <div style="padding:28px;line-height:1.8;font-size:14px;">
        <h2 style="margin-top:0;font-size:17px;color:#1c382b;">${bodyHeading}</h2>
        <p style="color:#444;margin:8px 0 16px 0;">${description}</p>
        ${codeBlock}
        ${rowsBlock}
      </div>
      <div style="border-top:1px solid #edf2ee;padding:16px 24px;text-align:center;font-size:12px;color:#5a7366;background-color:#fafcfb;">
        <p style="margin:2px 0;">این ایمیل به‌صورت خودکار توسط سامانه ترابار ارسال شده است.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
}

export async function sendEmailViaResend(params: {
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ ok: boolean; id?: string; error?: string; status?: number }> {
  const apiKey = getEnvVar("RESEND_API_KEY");
  const fromEmail = getEnvVar("RESEND_FROM_EMAIL", "ترابار <auth@terrabar.ir>");

  if (!apiKey) {
    return {
      ok: false,
      error: "کلید سرویس ایمیل (RESEND_API_KEY) در تنظیمات محیطی سرور تعریف نشده است.",
    };
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text || params.subject,
      }),
      signal: controller?.signal,
    });

    const data = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };

    if (response.ok && data?.id) {
      return { ok: true, id: data.id };
    }

    return {
      ok: false,
      status: response.status,
      error: data?.message || `خطای سرویس ایمیل با وضعیت ${response.status}`,
    };
  } catch (err: unknown) {
    const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const message = isTimeout
      ? "مهلت زمانی ارتباط با سرویس ایمیل (Resend) به پایان رسید."
      : err instanceof Error
        ? err.message
        : String(err);
    return { ok: false, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function sendOtpEmail(
  rawEmail: string,
  purpose: "signup" | "login" | "reset_password" = "signup",
): Promise<{ success: boolean; message: string; resendId?: string }> {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return {
      success: false,
      message: "نشانی ایمیل وارد شده معتبر نیست. لطفاً یک ایمیل صحیح وارد فرمایید.",
    };
  }

  const code = generateOtpCode();
  const expiresAt = Date.now() + 10 * 60 * 1000;

  otpStore.set(email, { code, expiresAt, attempts: 0 });
  if (globalForEmailHook.__terrabar_email_hook__?.saveOtp) {
    await globalForEmailHook.__terrabar_email_hook__.saveOtp(email, "email", code, expiresAt);
  }

  const subtitle =
    purpose === "reset_password"
      ? "درخواست بازیابی رمز عبور"
      : purpose === "login"
        ? "ورود به حساب کاربری ترابار"
        : "تکمیل ثبت‌نام و فعال‌سازی حساب ترابار";

  const description =
    purpose === "reset_password"
      ? "برای بازنشانی رمز عبور حساب خود در ترابار، کد تأیید زیر را در فرم وارد کنید:"
      : purpose === "login"
        ? "برای ورود امن به حساب کاربری خود در ترابار، کد تأیید زیر را در کادر مربوطه وارد نمایید:"
        : "برای تکمیل مراحل ثبت‌نام و عضویت در سامانه ترابار، کد ۶ رقمی زیر را وارد کنید:";

  const subject = `کد تأیید ترابار: ${code}`;
  const html = buildTerrabarEmailHtml({
    title: subject,
    bodyHeading: subtitle,
    description,
    code,
    expiresInMinutes: 10,
  });

  const resendResult = await sendEmailViaResend({
    to: email,
    subject,
    html,
    text: `${subtitle}\nکد تأیید شما: ${code}\nاین کد به مدت ۱۰ دقیقه معتبر است.`,
  });

  try {
    await globalForEmailHook.__terrabar_email_hook__?.logMessage?.({
      recipient: email,
      channel: "email",
      eventType: `email_otp_${purpose}`,
      messageSummary: subtitle,
      status: resendResult.ok ? "sent" : "failed",
      providerStatus: resendResult.status ? String(resendResult.status) : undefined,
      errorMessage: resendResult.ok ? undefined : resendResult.error,
    });
  } catch (logErr) {
    console.warn("[email-service] logMessage error:", logErr);
  }

  if (!resendResult.ok) {
    return {
      success: false,
      message: resendResult.error || "خطا در ارسال ایمیل تأیید. لطفاً تنظیمات سرویس ایمیل را بررسی کنید.",
    };
  }

  return {
    success: true,
    message: `کد تأیید ۶ رقمی با موفقیت به نشانی ${email} ارسال شد.`,
    resendId: resendResult.id,
  };
}

export async function verifyEmailOtpCode(
  rawEmail: string,
  inputCode: string,
): Promise<{ success: boolean; message: string }> {
  const email = normalizeEmail(rawEmail);
  const cleanCode = toAsciiDigits(inputCode || "").trim();

  if (!isValidEmail(email) || !/^\d{5,6}$/.test(cleanCode)) {
    return { success: false, message: "نشانی ایمیل یا کد تأیید نامعتبر است." };
  }

  if (globalForEmailHook.__terrabar_email_hook__?.verifyOtp) {
    return globalForEmailHook.__terrabar_email_hook__.verifyOtp(email, cleanCode);
  }

  const stored = otpStore.get(email);
  if (!stored) {
    return {
      success: false,
      message: "کد تأییدی برای این ایمیل ثبت نشده یا منقضی شده است. لطفاً دوباره درخواست کد دهید.",
    };
  }

  if (Date.now() > stored.expiresAt) {
    otpStore.delete(email);
    return { success: false, message: "کد تأیید منقضی شده است. لطفاً کد جدید درخواست کنید." };
  }

  stored.attempts += 1;
  if (stored.attempts > 5) {
    otpStore.delete(email);
    return { success: false, message: "تعداد تلاش‌های ناموفق بیش از حد مجاز بود." };
  }

  if (stored.code !== cleanCode) {
    return { success: false, message: "کد تأیید وارد شده صحیح نیست. لطفاً دوباره بررسی کنید." };
  }

  otpStore.delete(email);
  return { success: true, message: "کد تأیید ایمیل با موفقیت احراز شد." };
}

export async function sendEventNotificationEmail(params: {
  email: string;
  eventType: string;
  subject: string;
  heading: string;
  description: string;
  detailsRows?: Array<{ label: string; value: string }>;
  relatedId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const email = normalizeEmail(params.email);
  if (!isValidEmail(email) || email.endsWith("@terrabar.ir") && email.startsWith("phone_")) {
    return { ok: false, error: "ایمیل واقعی کاربر ثبت نشده است." };
  }

  const html = buildTerrabarEmailHtml({
    title: params.subject,
    bodyHeading: params.heading,
    description: params.description,
    detailsRows: params.detailsRows,
  });

  const res = await sendEmailViaResend({
    to: email,
    subject: params.subject,
    html,
    text: `${params.heading}\n${params.description}`,
  });

  await globalForEmailHook.__terrabar_email_hook__?.logMessage?.({
    recipient: email,
    channel: "email",
    eventType: params.eventType,
    messageSummary: params.subject,
    status: res.ok ? "sent" : "failed",
    providerStatus: res.status ? String(res.status) : undefined,
    errorMessage: res.ok ? undefined : res.error,
    relatedId: params.relatedId,
  });

  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
