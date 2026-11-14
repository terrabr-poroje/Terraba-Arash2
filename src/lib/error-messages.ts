/**
 * Centralized Persian error translator for both client and server (Cloudflare Workers / D1 / Fetch / Zod).
 * Guarantees that raw English system, runtime, database, or network errors are never shown to users.
 */

const HAS_PERSIAN_RE = /[\u0600-\u06FF]/;

const KNOWN_ERROR_PATTERNS: Array<{ match: RegExp; message: string }> = [
  {
    match: /handle_cross_request_promise_resolution|promise was created by a request that has since ended/i,
    message: "خطای همزمانی پردازش در سرور رخ داد. لطفاً یک‌بار صفحه را تازه کنید و دوباره تلاش نمایید.",
  },
  {
    match: /AbortError|TimeoutError|timed?\s*out|deadline exceeded/i,
    message: "مهلت زمانی ارتباط با سرور به پایان رسید. لطفاً دوباره تلاش کنید.",
  },
  {
    match: /Failed to fetch|NetworkError|Load failed|fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|socket hang up|network request failed/i,
    message: "خطا در برقراری ارتباط با سرور. لطفاً اتصال اینترنت خود را بررسی کنید.",
  },
  {
    match: /UNIQUE constraint failed|already exists/i,
    message: "این اطلاعات قبلاً در سامانه ثبت شده است.",
  },
  {
    match: /D1_ERROR|SQLITE_ERROR|no such column|no such table|has no column|syntax error|database is locked|SQLITE_BUSY/i,
    message: "خطا در ثبت یا خواندن اطلاعات از پایگاه داده. لطفاً دوباره تلاش کنید.",
  },
  {
    match: /PARSPACK|NoSuchKey|AccessDenied|SignatureDoesNotMatch|InvalidAccessKeyId/i,
    message: "خطا در ارتباط با سرویس ذخیره‌سازی فایل‌ها. لطفاً دوباره تلاش کنید.",
  },
  {
    match: /Unauthorized|invalid token|jwt expired|session expired/i,
    message: "نشست کاربری شما منقضی شده است. لطفاً مجدداً وارد حساب خود شوید.",
  },
  {
    match: /Forbidden|permission denied/i,
    message: "شما دسترسی مجاز برای انجام این عملیات را ندارید.",
  },
  {
    match: /Too many requests|rate limit/i,
    message: "تعداد درخواست‌ها بیش از حد مجاز است. لطفاً چند لحظه بعد دوباره تلاش کنید.",
  },
  {
    match: /Unexpected token|Unexpected end of JSON|JSON\.parse|is not valid JSON/i,
    message: "پاسخ دریافتی از سرور معتبر نیست. لطفاً صفحه را تازه کنید و دوباره تلاش نمایید.",
  },
  {
    match: /^(Required|Expected .+|Invalid (input|enum value|string|number|type|email|url)|String must contain .+|Number must be .+)$/i,
    message: "لطفاً تمام فیلدهای ضروری را با مقادیر معتبر تکمیل کنید.",
  },
];

export function extractRawErrorText(error: unknown): string {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return (error.message || error.name || "").trim();
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === "string" && obj.message.trim()) return obj.message.trim();
    if (typeof obj.error === "string" && obj.error.trim()) return obj.error.trim();
  }
  return "";
}

export function toPersianErrorMessage(
  error: unknown,
  fallback = "خطایی در پردازش درخواست رخ داد. لطفاً دوباره تلاش کنید.",
): string {
  const raw = extractRawErrorText(error);
  if (!raw) return fallback;

  for (const entry of KNOWN_ERROR_PATTERNS) {
    if (entry.match.test(raw)) {
      return entry.message;
    }
  }

  // If the message already contains Persian characters, strip any trailing raw technical prefix/detail if needed
  if (HAS_PERSIAN_RE.test(raw)) {
    const cleaned = raw
      .replace(/:\s*(D1_ERROR|SQLITE_ERROR|TypeError|ReferenceError|Error):.*$/i, "")
      .trim();
    return cleaned || fallback;
  }

  // Never expose purely English system/runtime errors to the user
  return fallback;
}
