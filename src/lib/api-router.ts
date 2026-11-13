/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from "zod";
import { setRuntimeEnv } from "./runtime-env";
import { sendOtpSms, verifyOtpCode, normalizeIranMobile, toAsciiDigits } from "./sms-service";
import { sendOtpEmail, verifyEmailOtpCode } from "./email-service";
import {
  setCloudflareD1Binding,
  initD1Schema,
  getD1,
  checkRateLimit,
  registerOrLoginUserWithPhone,
  registerOrLoginUserWithEmail,
  validateD1Session,
  invalidateD1Session,
  updateUserProfile,
  authenticateAdmin,
  setAdminPassword,
  getAdminPhoneForOtp,
  getAdminRecoveryEmail,
  getPendingRoleRequests,
  updateRoleApprovalStatus,
  submitMembershipRequest,
  getMyRoleRequests,
  resubmitSellingApprovalRequest,
  getMemberSellingStatus,
  requestUserPasswordResetOtp,
  resetUserPasswordWithOtp,
  getCityAccessForUser,
  syncLoadToDatabase,
  getLoadByIdFromDatabase,
  getAllLoadsFromDatabase,
  updateLoadStatusInDatabase,
  deleteLoadFromDatabase,
  getCartFromDatabase,
  upsertCartItemsInDatabase,
  clearCartInDatabase,
  syncOrderToDatabase,
  updateOrderLifecycle,
  getOrdersFromDatabase,
  createPurchaseRequest,
  getPurchaseRequests,
  updatePurchaseRequestStatus,
  getRatingsSummary,
  checkOrderReviewEligibility,
  createRating,
  getRatingMessages,
  addRatingMessage,
  getMemberFinanceSummary,
  upsertSellerBankAccount,
  requestSellerPayout,
  recordSiteVisit,
  getAdminDashboardData,
  adminUpdateMember,
  adminManageCityManager,
  adminVerifyBankAccount,
  adminCreatePayout,
  adminUpdatePayoutStatus,
  toggleCityNeighbor,
  getDatabaseStats,
  exportDatabaseAsJson,
  exportDatabaseAsSql,
  getSqliteDatabaseBinary,
  recordAuditLog,
  type UserAuthResult,
} from "./d1-database";
import {
  uploadToParsPack,
  deleteFromParsPack,
  getFileFromParsPack,
} from "./parspack-storage";

function jsonResponse(
  data: any,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      ...extraHeaders,
    },
  });
}

function extractSessionToken(request: Request): string {
  const authHeader = request.headers.get("authorization") || "";
  const cookieHeader = request.headers.get("cookie") || "";
  let token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token && cookieHeader.includes("tb_session=")) {
    const match = cookieHeader.match(/tb_session=([^;]+)/);
    if (match) token = decodeURIComponent(match[1]);
  }
  return token;
}

async function getRequestSession(request: Request): Promise<UserAuthResult | null> {
  const token = extractSessionToken(request);
  if (!token) return null;
  return validateD1Session(token);
}

function isAdminSession(session: UserAuthResult | null): boolean {
  if (!session) return false;
  return session.roles.some((r) =>
    ["admin", "main_admin", "main-administrator", "city_manager"].includes(r.toLowerCase()),
  );
}

function isMainAdminSession(session: UserAuthResult | null): boolean {
  if (!session) return false;
  return session.roles.some((r) =>
    ["admin", "main_admin", "main-administrator"].includes(r.toLowerCase()),
  );
}

function hasSellingPermission(session: UserAuthResult | null): boolean {
  if (!session) return false;
  return session.roles.some((r) =>
    ["seller", "bar_seller", "supplier", "admin", "main_admin"].includes(r.toLowerCase()),
  );
}

function hasProfessionalPurchasePermission(session: UserAuthResult | null): boolean {
  if (!session) return false;
  return session.roles.some((r) =>
    ["seller", "bar_seller", "supplier", "special_buyer", "buyer_special", "admin", "main_admin"].includes(
      r.toLowerCase(),
    ),
  );
}

function getClientKey(request: Request): string {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "local"
  );
}

async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<{ data?: T; error?: string }> {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object") {
    return { error: "ساختار درخواست JSON نامعتبر است." };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return { error: firstIssue?.message || "ورودی‌های ارسال‌شده معتبر نیستند." };
  }
  return { data: parsed.data };
}

export async function handleApiRequest(request: Request, env?: any): Promise<Response | null> {
  const resolvedEnv =
    env ??
    (request as any)?.runtime?.cloudflare?.env ??
    (globalThis as any)?.__env__;
  if (resolvedEnv) {
    setRuntimeEnv(resolvedEnv);
    if (resolvedEnv.DB) setCloudflareD1Binding(resolvedEnv.DB);
  }

  const url = new URL(request.url, "http://localhost:3000");
  if (!url.pathname.startsWith("/api/")) {
    return null;
  }

  await initD1Schema();
  const method = request.method.toUpperCase();
  const pathname = url.pathname;
  const clientIp = getClientKey(request);

  // ==========================================
  // SMS & Email OTP Endpoints
  // ==========================================

  if (pathname === "/api/sms/send-otp" && method === "POST") {
    const rl = await checkRateLimit(`sms_send:${clientIp}`, 8, 10 * 60 * 1000);
    if (!rl.allowed) {
      return jsonResponse(
        { success: false, message: `درخواست بیش از حد مجاز. لطفاً ${rl.retryAfterSec} ثانیه صبر کنید.` },
        429,
      );
    }

    const parsed = await parseJson(
      request,
      z.object({ mobile: z.string().min(10, "شماره موبایل الزامی است") }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const result = await sendOtpSms(parsed.data.mobile);
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (pathname === "/api/sms/verify-otp" && method === "POST") {
    const rl = await checkRateLimit(`sms_verify:${clientIp}`, 12, 10 * 60 * 1000);
    if (!rl.allowed) {
      return jsonResponse({ success: false, message: "تعداد تلاش‌های شما بیش از حد مجاز است." }, 429);
    }

    const parsed = await parseJson(
      request,
      z.object({
        mobile: z.string().min(10),
        code: z.string().min(5).max(6),
        fullName: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        role: z.string().optional(),
        activity: z.string().optional(),
        mode: z.enum(["login", "signup"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const verifyResult = await verifyOtpCode(parsed.data.mobile, parsed.data.code);
    if (!verifyResult.success) return jsonResponse(verifyResult, 400);

    try {
      const authResult = await registerOrLoginUserWithPhone({
        phone: parsed.data.mobile,
        fullName: parsed.data.fullName,
        city: parsed.data.city,
        province: parsed.data.province,
        role: parsed.data.role,
        activity: parsed.data.activity,
        mode: parsed.data.mode,
      });

      return jsonResponse(
        {
          success: true,
          message: "ورود با موفقیت انجام شد.",
          user: authResult.user,
          member: authResult.member,
          roles: authResult.roles,
          sessionToken: authResult.sessionToken,
        },
        200,
        { "Set-Cookie": `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax` },
      );
    } catch (e: any) {
      return jsonResponse({ success: false, message: e?.message || "خطا در ثبت‌نام یا ورود" }, 400);
    }
  }

  if (pathname === "/api/email/send-otp" && method === "POST") {
    const rl = await checkRateLimit(`email_send:${clientIp}`, 8, 10 * 60 * 1000);
    if (!rl.allowed) {
      return jsonResponse({ success: false, message: "درخواست بیش از حد مجاز؛ دقایقی بعد تلاش کنید." }, 429);
    }

    const parsed = await parseJson(
      request,
      z.object({
        email: z.string().email("نشانی ایمیل معتبر نیست"),
        purpose: z.enum(["signup", "login", "reset_password"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const result = await sendOtpEmail(parsed.data.email, parsed.data.purpose || "signup");
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (pathname === "/api/email/verify-otp" && method === "POST") {
    const rl = await checkRateLimit(`email_verify:${clientIp}`, 12, 10 * 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "تلاش بیش از حد مجاز." }, 429);

    const parsed = await parseJson(
      request,
      z.object({
        email: z.string().email("نشانی ایمیل معتبر نیست"),
        code: z.string().min(5).max(6),
        fullName: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        role: z.string().optional(),
        activity: z.string().optional(),
        mode: z.enum(["login", "signup"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const verifyResult = await verifyEmailOtpCode(parsed.data.email, parsed.data.code);
    if (!verifyResult.success) return jsonResponse(verifyResult, 400);

    try {
      const authResult = await registerOrLoginUserWithEmail({
        email: parsed.data.email,
        fullName: parsed.data.fullName,
        city: parsed.data.city,
        province: parsed.data.province,
        role: parsed.data.role,
        activity: parsed.data.activity,
        mode: parsed.data.mode,
      });

      return jsonResponse(
        {
          success: true,
          message: "ورود با ایمیل با موفقیت انجام شد.",
          user: authResult.user,
          member: authResult.member,
          roles: authResult.roles,
          sessionToken: authResult.sessionToken,
        },
        200,
        { "Set-Cookie": `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax` },
      );
    } catch (e: any) {
      return jsonResponse({ success: false, message: e?.message || "خطا در ورود با ایمیل" }, 400);
    }
  }

  if (pathname === "/api/auth/email-login" && method === "POST") {
    const rl = await checkRateLimit(`email_login:${clientIp}`, 15, 10 * 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "تلاش‌های ورود بیش از حد مجاز است." }, 429);

    const parsed = await parseJson(
      request,
      z.object({
        email: z.string().email("نشانی ایمیل معتبر نیست"),
        password: z.string().optional(),
        fullName: z.string().optional(),
        phone: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        role: z.string().optional(),
        activity: z.string().optional(),
        mode: z.enum(["login", "signup"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    try {
      const authResult = await registerOrLoginUserWithEmail(parsed.data);
      return jsonResponse(
        {
          success: true,
          message: "ورود با موفقیت انجام شد.",
          user: authResult.user,
          member: authResult.member,
          roles: authResult.roles,
          sessionToken: authResult.sessionToken,
        },
        200,
        { "Set-Cookie": `tb_session=${authResult.sessionToken}; Path=/; Max-Age=2592000; SameSite=Lax` },
      );
    } catch (e: any) {
      return jsonResponse({ success: false, message: e?.message || "خطا در احراز هویت با ایمیل" }, 400);
    }
  }

  if (pathname === "/api/auth/session" && method === "GET") {
    const session = await getRequestSession(request);
    return jsonResponse({ session });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    const body = (await request.json().catch(() => ({}))) as { token?: string };
    const token = body?.token || extractSessionToken(request);
    if (token) await invalidateD1Session(token);
    return jsonResponse({ success: true }, 200, {
      "Set-Cookie": "tb_session=; Path=/; Max-Age=0; SameSite=Lax",
    });
  }

  if (pathname === "/api/auth/send-password-reset-otp" && method === "POST") {
    const rl = await checkRateLimit(`pwd_reset:${clientIp}`, 6, 10 * 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "لطفاً چند دقیقه بعد مجدداً تلاش کنید." }, 429);

    const parsed = await parseJson(
      request,
      z.object({
        identifier: z.string().min(3),
        preferredMethod: z.enum(["sms", "email"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
    const result = await requestUserPasswordResetOtp(parsed.data.identifier, parsed.data.preferredMethod);
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (pathname === "/api/auth/reset-password-with-otp" && method === "POST") {
    const parsed = await parseJson(
      request,
      z.object({
        identifier: z.string().min(3),
        code: z.string().min(5),
        newPassword: z.string().min(6, "رمز عبور جدید باید حداقل ۶ کاراکتر باشد."),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
    const result = await resetUserPasswordWithOtp(parsed.data);
    return jsonResponse(result, result.success ? 200 : 400);
  }

  // ==========================================
  // Account & Profile
  // ==========================================

  if (pathname === "/api/account/overview" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const memberId = session.member?.id || "";
    const [roles, myRequests, orders, financeSummary, sellingStatus, cityAccess] = await Promise.all([
      getMyRoleRequests(session.user.id),
      getPurchaseRequests({ buyerMemberId: memberId }),
      getOrdersFromDatabase({ buyerMemberId: memberId, sellerMemberId: memberId }),
      getMemberFinanceSummary(memberId),
      getMemberSellingStatus(session.user.id),
      getCityAccessForUser(session.user.id),
    ]);

    return jsonResponse({
      success: true,
      user: session.user,
      member: session.member,
      roles: session.roles,
      roleRequests: roles,
      purchaseRequests: myRequests,
      orders,
      financeSummary,
      sellingStatus,
      cityAccess,
    });
  }

  if (pathname === "/api/account/profile" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        fullName: z.string().min(2).optional(),
        email: z.string().email().optional().or(z.literal("")),
        city: z.string().optional(),
        province: z.string().optional(),
        activity: z.string().optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const updated = await updateUserProfile(session.user.id, parsed.data);
    return jsonResponse({ success: Boolean(updated), ...updated });
  }

  if (pathname === "/api/account/city-access" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) {
      return jsonResponse({
        success: true,
        city: "",
        accessMode: "unavailable",
        allowedCities: [],
        approvedRoleCodes: [],
      });
    }
    const access = await getCityAccessForUser(session.user.id);
    return jsonResponse({ success: true, ...access });
  }

  // ==========================================
  // Membership Endpoints (Authenticated)
  // ==========================================

  if (pathname === "/api/membership/resubmit-selling-request" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const body = (await request.json().catch(() => ({}))) as any;
    const result = await resubmitSellingApprovalRequest({
      userId: session.user.id,
      memberId: session.member?.id || body.memberId,
      roleCode: body.roleCode,
      fullName: body.fullName,
      phone: body.phone,
      city: body.city,
      province: body.province,
      note: body.note,
    });
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (pathname === "/api/membership/submit-request" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        fullName: z.string().optional(),
        phone: z.string().optional(),
        province: z.string().optional(),
        city: z.string().optional(),
        role: z.string().min(1),
        description: z.string().optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const result = await submitMembershipRequest({
      userId: session.user.id,
      memberId: session.member?.id,
      fullName: parsed.data.fullName,
      phone: parsed.data.phone,
      province: parsed.data.province,
      city: parsed.data.city,
      role: parsed.data.role,
      description: parsed.data.description,
    });
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (pathname === "/api/membership/my-requests" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, requests: [] }, 401);
    const requests = await getMyRoleRequests(session.user.id);
    return jsonResponse({ success: true, requests });
  }

  if (pathname === "/api/membership/selling-status" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, status: null }, 401);
    const status = await getMemberSellingStatus(session.user.id);
    return jsonResponse({ success: true, status });
  }

  // ==========================================
  // Loads Endpoints (Market, Professional, CRUD)
  // ==========================================

  if (pathname === "/api/loads/list" && method === "GET") {
    const session = await getRequestSession(request);
    const memberId = url.searchParams.get("memberId") || undefined;
    const status = url.searchParams.get("status") || undefined;
    const city = url.searchParams.get("city") || undefined;
    const mode = (url.searchParams.get("mode") as "market" | "professional" | "all") || "market";

    if (mode === "professional" && !hasProfessionalPurchasePermission(session)) {
      return jsonResponse({
        success: true,
        loads: [],
        accessDenied: true,
        message: "مشاهده بارهای ویژه حرفه‌ای نیازمند عضویت تأییدشدهٔ خریدار ویژه، بارفروش یا تأمین‌کننده است.",
      });
    }

    if (memberId && session?.member?.id !== memberId && !isAdminSession(session)) {
      // Allow public store view ONLY for active loads of a member
      const loads = await getAllLoadsFromDatabase({ memberId, status: "active", city, mode });
      return jsonResponse({ success: true, loads });
    }

    const loads = await getAllLoadsFromDatabase({
      memberId,
      status: memberId ? status : status || "active",
      city,
      mode: memberId ? "all" : mode,
    });
    return jsonResponse({ success: true, loads });
  }

  if (pathname === "/api/loads/detail" && method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!id) return jsonResponse({ success: false, message: "شناسه بار الزامی است." }, 400);
    const load = await getLoadByIdFromDatabase(id);
    if (!load) return jsonResponse({ success: false, message: "بار مورد نظر پیدا نشد." }, 404);
    return jsonResponse({ success: true, load });
  }

  if (pathname === "/api/loads/sync" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    if (!hasSellingPermission(session)) {
      return jsonResponse(
        { success: false, message: "ثبت و ویرایش بار فقط برای بارفروشان و تأمین‌کنندگان تأییدشده مجاز است." },
        403,
      );
    }

    const body = (await request.json().catch(() => null)) as any;
    if (!body || !body.product_type) {
      return jsonResponse({ success: false, message: "نوع محصول الزامی است." }, 400);
    }

    // Verify ownership on edit
    if (body.id) {
      const existing = await getLoadByIdFromDatabase(String(body.id));
      if (
        existing &&
        existing.member_id !== session.member.id &&
        existing.owner_member_id !== session.member.id &&
        !isAdminSession(session)
      ) {
        return jsonResponse({ success: false, message: "شما مجوز ویرایش این بار را ندارید." }, 403);
      }
    }

    const saved = await syncLoadToDatabase({
      ...body,
      member_id: isAdminSession(session) && body.member_id ? body.member_id : session.member.id,
      status: isAdminSession(session) ? body.status || "active" : body.status || "active",
    });

    await recordAuditLog({
      actorUserId: session.user.id,
      actorRole: session.roles.join(","),
      action: body.id ? "load_updated" : "load_created",
      targetType: "load",
      targetId: saved?.id,
      details: `${saved?.product_type} (${saved?.city})`,
    });

    return jsonResponse({ success: true, load: saved, message: "اعلان بار در پایگاه داده ثبت شد." });
  }

  if (pathname === "/api/loads/status" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    const parsed = await parseJson(
      request,
      z.object({ id: z.string().min(1), status: z.enum(["active", "inactive", "pending", "rejected", "archived"]) }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const existing = await getLoadByIdFromDatabase(parsed.data.id);
    if (!existing) return jsonResponse({ success: false, message: "بار پیدا نشد." }, 404);
    if (
      existing.member_id !== session.member.id &&
      existing.owner_member_id !== session.member.id &&
      !isAdminSession(session)
    ) {
      return jsonResponse({ success: false, message: "شما مجوز تغییر وضعیت این بار را ندارید." }, 403);
    }

    await updateLoadStatusInDatabase(parsed.data.id, parsed.data.status);
    return jsonResponse({ success: true, message: "وضعیت بار به‌روزرسانی شد." });
  }

  if (pathname === "/api/loads/delete" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    const parsed = await parseJson(
      request,
      z.object({ id: z.string().min(1), softArchive: z.boolean().optional() }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const existing = await getLoadByIdFromDatabase(parsed.data.id);
    if (!existing) return jsonResponse({ success: false, message: "بار پیدا نشد." }, 404);
    if (
      existing.member_id !== session.member.id &&
      existing.owner_member_id !== session.member.id &&
      !isAdminSession(session)
    ) {
      return jsonResponse({ success: false, message: "شما مجوز حذف این بار را ندارید." }, 403);
    }

    await deleteLoadFromDatabase(parsed.data.id, Boolean(parsed.data.softArchive));
    await recordAuditLog({
      actorUserId: session.user.id,
      actorRole: session.roles.join(","),
      action: parsed.data.softArchive ? "load_archived" : "load_deleted",
      targetType: "load",
      targetId: parsed.data.id,
    });
    return jsonResponse({ success: true, message: "بار با موفقیت حذف شد." });
  }

  // ==========================================
  // Cart (6h Persistence in D1)
  // ==========================================

  if (pathname === "/api/cart" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: true, items: [] });
    const items = await getCartFromDatabase(session.user.id);
    return jsonResponse({ success: true, items });
  }

  if (pathname === "/api/cart" && (method === "POST" || method === "PUT")) {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    const parsed = await parseJson(
      request,
      z.object({
        items: z.array(
          z.object({
            loadId: z.string().min(1),
            saleType: z.string().default("regular"),
            quantity: z.number().int().positive(),
            expiresAt: z.number().optional(),
          }),
        ),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    await upsertCartItemsInDatabase(session.user.id, session.member.id, parsed.data.items);
    return jsonResponse({ success: true });
  }

  if (pathname === "/api/cart" && method === "DELETE") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: true });
    await clearCartInDatabase(session.user.id);
    return jsonResponse({ success: true });
  }

  // ==========================================
  // Orders & Lifecycle
  // ==========================================

  if (pathname === "/api/orders/sync" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "برای ثبت سفارش ابتدا وارد حساب شوید." }, 401);

    const rl = await checkRateLimit(`order_create:${session.user.id}`, 20, 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "تعداد درخواست سفارش زیاد است؛ کمی صبر کنید." }, 429);

    const body = (await request.json().catch(() => null)) as any;
    if (!body) return jsonResponse({ success: false, message: "اطلاعات سفارش ارسال نشده است." }, 400);

    try {
      const saved = await syncOrderToDatabase({
        ...body,
        buyer_member_id: session.member.id,
        customer_name: body.customer_name || session.member.full_name || session.user.full_name,
        customer_phone: body.customer_phone || session.member.phone || session.user.phone || "",
        customer_email: body.customer_email || session.member.email || session.user.email || "",
        customer_city: body.customer_city || session.member.city || session.user.city || "",
      });
      return jsonResponse({ success: true, order: saved, message: "سفارش در پایگاه داده ثبت شد." });
    } catch (e: any) {
      return jsonResponse({ success: false, message: e?.message || "خطا در ثبت سفارش" }, 400);
    }
  }

  if (pathname === "/api/orders/list" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, orders: [], message: "ابتدا وارد حساب شوید." }, 401);

    const buyerMemberId = url.searchParams.get("buyerMemberId") || undefined;
    const sellerMemberId = url.searchParams.get("sellerMemberId") || undefined;

    if (!isAdminSession(session)) {
      const ownMemberId = session.member.id;
      const orders = await getOrdersFromDatabase({
        buyerMemberId: sellerMemberId ? undefined : ownMemberId,
        sellerMemberId: sellerMemberId ? ownMemberId : buyerMemberId ? undefined : ownMemberId,
      });
      return jsonResponse({ success: true, orders });
    }

    const orders = await getOrdersFromDatabase({ buyerMemberId, sellerMemberId });
    return jsonResponse({ success: true, orders });
  }

  if (pathname === "/api/orders/update-status" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        orderId: z.string().min(1),
        action: z.enum(["accept", "reject", "ship", "deliver", "mark_paid"]),
        notes: z.string().optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const db = getD1();
    const order = await db.prepare("SELECT * FROM orders WHERE id = ? LIMIT 1").bind(parsed.data.orderId).first<any>();
    if (!order) return jsonResponse({ success: false, message: "سفارش پیدا نشد." }, 404);

    const isSeller = order.seller_member_id === session.member.id;
    const isBuyer = order.buyer_member_id === session.member.id;
    const isAdmin = isAdminSession(session);

    if (!isAdmin && !isSeller && !(isBuyer && parsed.data.action === "deliver")) {
      return jsonResponse({ success: false, message: "شما مجوز تغییر وضعیت این سفارش را ندارید." }, 403);
    }

    const result = await updateOrderLifecycle({
      orderId: parsed.data.orderId,
      action: parsed.data.action,
      actorUserId: session.user.id,
      actorRole: session.roles.join(","),
      notes: parsed.data.notes,
    });

    return jsonResponse(result, result.success ? 200 : 400);
  }

  // ==========================================
  // Purchase Requests (درخواست خرید مستقیم)
  // ==========================================

  if (pathname === "/api/purchase-requests/create" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        loadId: z.string().optional().nullable(),
        productType: z.string().min(1, "نوع محصول را مشخص کنید"),
        quantity: z.number().positive("مقدار باید بزرگ‌تر از صفر باشد"),
        quantityUnit: z.string().optional(),
        destinationCity: z.string().min(1, "شهر مقصد را وارد کنید"),
        qualityRequirements: z.string().optional(),
        neededBy: z.string().optional(),
        maxPrice: z.number().optional(),
        notes: z.string().optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const created = await createPurchaseRequest({
      ...parsed.data,
      buyerMemberId: session.member.id,
    });
    return jsonResponse({ success: true, request: created, message: "درخواست خرید با موفقیت ثبت شد." });
  }

  if (pathname === "/api/purchase-requests/list" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, requests: [] }, 401);
    const onlyDirect = url.searchParams.get("onlyDirect") === "true";
    const all = url.searchParams.get("all") === "true" && isAdminSession(session);
    const requests = await getPurchaseRequests({
      buyerMemberId: all ? undefined : session.member.id,
      onlyDirect,
    });
    return jsonResponse({ success: true, requests });
  }

  if (pathname === "/api/purchase-requests/update-status" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({ id: z.string().min(1), status: z.enum(["open", "matched", "closed", "cancelled"]) }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const ok = await updatePurchaseRequestStatus(parsed.data.id, parsed.data.status);
    return jsonResponse({ success: ok });
  }

  // ==========================================
  // Ratings & Messages
  // ==========================================

  if (pathname === "/api/ratings/summary" && method === "GET") {
    const targetType = url.searchParams.get("targetType") === "load" ? "load" : "member";
    const targetId = url.searchParams.get("targetId") || "";
    if (!targetId) return jsonResponse({ success: true, count: 0, average: 0, ratings: [] });
    const summary = await getRatingsSummary(targetType, targetId);
    return jsonResponse({ success: true, ...summary });
  }

  if (pathname === "/api/ratings/order-check" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: true, eligible: false, alreadyReviewed: false });
    const orderId = url.searchParams.get("orderId") || "";
    const result = await checkOrderReviewEligibility(orderId, session.member.id);
    return jsonResponse({ success: true, ...result });
  }

  if (pathname === "/api/ratings/create" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        targetType: z.enum(["member", "load"]),
        targetMemberId: z.string().optional(),
        targetLoadId: z.string().optional(),
        orderId: z.string().optional(),
        score: z.number().min(1).max(5),
        reviewText: z.string().optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const created = await createRating({
      ...parsed.data,
      reviewerMemberId: session.member.id,
    });
    return jsonResponse({ success: true, rating: created, message: "امتیاز و دیدگاه شما ثبت شد." });
  }

  if (pathname === "/api/ratings/messages" && method === "GET") {
    const ratingId = url.searchParams.get("ratingId") || "";
    const messages = ratingId ? await getRatingMessages(ratingId) : [];
    return jsonResponse({ success: true, messages });
  }

  if (pathname === "/api/ratings/send-message" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    const parsed = await parseJson(
      request,
      z.object({ ratingId: z.string().min(1), message: z.string().min(1) }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
    const msg = await addRatingMessage(parsed.data.ratingId, session.user.id, parsed.data.message);
    return jsonResponse({ success: true, message: msg });
  }

  // ==========================================
  // Storefront & Public Member Profile
  // ==========================================

  if (pathname === "/api/store/profile" && method === "GET") {
    const memberId = url.searchParams.get("memberId") || "";
    if (!memberId) return jsonResponse({ success: false, message: "شناسه غرفه مشخص نشده است." }, 400);
    const db = getD1();
    const member = await db.prepare("SELECT id, full_name, city, province, role, verification_status, products, joined_at FROM members WHERE id = ? LIMIT 1").bind(memberId).first<any>();
    if (!member) return jsonResponse({ success: false, message: "غرفه پیدا نشد." }, 404);
    const [loads, ratings] = await Promise.all([
      getAllLoadsFromDatabase({ memberId, status: "active", mode: "all" }),
      getRatingsSummary("member", memberId),
    ]);
    return jsonResponse({ success: true, member, loads, ratings });
  }

  // ==========================================
  // Finance (5% Commission, IBAN, Payout Requests)
  // ==========================================

  if (pathname === "/api/finance/summary" && method === "GET") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    const summary = await getMemberFinanceSummary(session.member.id);
    return jsonResponse({ success: true, ...summary, member: session.member });
  }

  if (pathname === "/api/finance/bank-account" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({
        bankName: z.string().min(2, "نام بانک الزامی است"),
        accountHolderName: z.string().min(2, "نام صاحب حساب الزامی است"),
        iban: z.string().min(24, "شماره شبا معتبر نیست"),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    try {
      const bankAccount = await upsertSellerBankAccount({
        memberId: session.member.id,
        bankName: parsed.data.bankName,
        accountHolderName: parsed.data.accountHolderName,
        iban: parsed.data.iban,
      });
      return jsonResponse({
        success: true,
        bankAccount,
        message: "اطلاعات بانکی و شماره شبا ثبت شد و پس از تأیید مدیر فعال می‌شود.",
      });
    } catch (e: any) {
      return jsonResponse({ success: false, message: e?.message || "خطا در ثبت شماره شبا" }, 400);
    }
  }

  if (pathname === "/api/finance/request-payout" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);

    const parsed = await parseJson(
      request,
      z.object({ amount: z.number().positive(), description: z.string().optional() }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const result = await requestSellerPayout({
      memberId: session.member.id,
      amount: parsed.data.amount,
      description: parsed.data.description,
    });
    return jsonResponse(result, result.success ? 200 : 400);
  }

  // ==========================================
  // Site Visits
  // ==========================================

  if (pathname === "/api/visits/record" && method === "POST") {
    const session = await getRequestSession(request);
    const body = (await request.json().catch(() => ({}))) as { route?: string };
    await recordSiteVisit({
      userId: session?.user?.id,
      memberId: session?.member?.id,
      route: body?.route || "/",
    });
    return jsonResponse({ success: true });
  }

  // ==========================================
  // ParsPack Storage Endpoints
  // ==========================================

  if (pathname === "/api/storage/upload" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    if (!hasSellingPermission(session)) {
      return jsonResponse({ success: false, message: "بارگذاری تصویر بار فقط برای فروشندگان تأییدشده مجاز است." }, 403);
    }

    const rl = await checkRateLimit(`upload:${session.user.id}`, 30, 10 * 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "تعداد آپلودها بیش از حد مجاز است." }, 429);

    try {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const folder = String(formData.get("folder") || "uploads").replace(/[^a-zA-Z0-9/_-]/g, "");
      const customKey = formData.get("key") as string | null;

      if (!file) {
        return jsonResponse({ success: false, message: "فایلی جهت بارگذاری ارسال نشده است." }, 400);
      }

      const arrayBuffer = await file.arrayBuffer();
      if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
        return jsonResponse({ success: false, message: "حجم فایل نباید بیشتر از ۸ مگابایت باشد." }, 400);
      }

      const buffer = new Uint8Array(arrayBuffer);
      let key: string;
      if (customKey) {
        key = customKey.replace(/\.[^.]+$/, "") + ".webp";
      } else {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const random = Math.random().toString(36).substring(2, 10);
        key = `${folder}/${year}/${month}/${Date.now()}_${random}.webp`;
      }

      const uploadResult = await uploadToParsPack(key, buffer, "image/webp");
      return jsonResponse({
        success: true,
        fileKey: uploadResult.key,
        url: uploadResult.url,
        size: buffer.byteLength,
        contentType: "image/webp",
        message: "فایل با موفقیت با فرمت WebP در فضای ابری ذخیره شد.",
      });
    } catch (err: any) {
      return jsonResponse({ success: false, message: `خطا در بارگذاری فایل: ${err?.message || err}` }, 500);
    }
  }

  if (pathname === "/api/storage/delete" && method === "POST") {
    const session = await getRequestSession(request);
    if (!session) return jsonResponse({ success: false, message: "ابتدا وارد حساب شوید." }, 401);
    if (!hasSellingPermission(session)) {
      return jsonResponse({ success: false, message: "دسترسی حذف فایل ندارید." }, 403);
    }

    const parsed = await parseJson(request, z.object({ key: z.string().min(1) }));
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    try {
      const deleteResult = await deleteFromParsPack(parsed.data.key);
      return jsonResponse(deleteResult);
    } catch (err: any) {
      return jsonResponse({ success: false, message: `خطا در حذف فایل: ${err?.message || err}` }, 500);
    }
  }

  if (pathname.startsWith("/api/storage/file/") && method === "GET") {
    const fileKey = decodeURIComponent(pathname.replace(/^\/api\/storage\/file\//, ""));
    if (!fileKey) return new Response("Not found", { status: 404 });

    try {
      const fileData = await getFileFromParsPack(fileKey);
      if (!fileData || !fileData.stream) return new Response("File not found", { status: 404 });

      const headers: Record<string, string> = {
        "Content-Type": fileData.contentType || "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
      };
      if (fileData.contentLength) headers["Content-Length"] = String(fileData.contentLength);

      return new Response(fileData.stream, { status: 200, headers });
    } catch {
      return new Response("Error fetching file", { status: 500 });
    }
  }

  // ==========================================
  // Admin Login & Password Reset
  // ==========================================

  if (pathname === "/api/admin/login" && method === "POST") {
    const rl = await checkRateLimit(`admin_login:${clientIp}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return jsonResponse(
        { success: false, message: "تلاش‌های ناموفق ورود مدیر بیش از حد مجاز است." },
        429,
      );
    }

    const parsed = await parseJson(
      request,
      z.object({ username: z.string().min(1), password: z.string().min(1) }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const auth = await authenticateAdmin(parsed.data.username, parsed.data.password);
    if (!auth.success || !auth.result) {
      return jsonResponse({ success: false, message: auth.message }, 401);
    }

    return jsonResponse(
      {
        success: true,
        message: auth.message,
        user: auth.result.user,
        member: auth.result.member,
        roles: auth.result.roles,
        sessionToken: auth.result.sessionToken,
      },
      200,
      { "Set-Cookie": `tb_session=${auth.result.sessionToken}; Path=/; Max-Age=604800; SameSite=Lax` },
    );
  }

  if (pathname === "/api/admin/request-password-otp" && method === "POST") {
    const rl = await checkRateLimit(`admin_otp:${clientIp}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) return jsonResponse({ success: false, message: "تعداد درخواست کد زیاد است." }, 429);

    const rawBody = (await request.json().catch(() => ({}))) as {
      method?: "sms" | "email";
      identifier?: string;
    };
    const requestedMethod = rawBody?.method === "email" ? "email" : "sms";
    const typedIdentifier = typeof rawBody?.identifier === "string" ? rawBody.identifier.trim() : "";

    if (requestedMethod === "email") {
      const adminEmail = getAdminRecoveryEmail();
      if (!adminEmail) {
        return jsonResponse(
          {
            success: false,
            message:
              "ایمیل بازیابی مدیر (ADMIN_RECOVERY_EMAIL) در تنظیمات متغیرهای محیطی کلودفلر تعریف نشده است.",
          },
          400,
        );
      }

      if (typedIdentifier && typedIdentifier.toLowerCase() !== adminEmail.toLowerCase()) {
        return jsonResponse(
          {
            success: false,
            message: "نشانی ایمیل واردشده با ایمیل بازیابی مدیر کل مطابقت ندارد.",
          },
          400,
        );
      }

      const emailRes = await sendOtpEmail(adminEmail, "reset_password");
      const parts = adminEmail.split("@");
      const maskedEmail = (parts[0]?.slice(0, 3) || "") + "***@" + (parts[1] || "");
      return jsonResponse(
        {
          success: emailRes.success,
          method: "email",
          target: maskedEmail,
          message: emailRes.success
            ? `کد تأیید ۶ رقمی به ایمیل بازیابی مدیر (${maskedEmail}) ارسال شد.`
            : emailRes.message,
        },
        emailRes.success ? 200 : 400,
      );
    }

    const adminPhone = getAdminPhoneForOtp();
    if (typedIdentifier) {
      const cleanTyped = normalizeIranMobile(toAsciiDigits(typedIdentifier));
      if (cleanTyped !== adminPhone) {
        return jsonResponse(
          {
            success: false,
            message: "شماره تماس واردشده با شماره مدیر کل مطابقت ندارد.",
          },
          400,
        );
      }
    }

    const smsResult = await sendOtpSms(adminPhone, "admin_password_otp");
    const maskedPhone = adminPhone.length >= 8 ? adminPhone.slice(0, 4) + "***" + adminPhone.slice(-4) : adminPhone;
    return jsonResponse(
      {
        success: smsResult.success,
        method: "sms",
        target: maskedPhone,
        message: smsResult.success
          ? `کد تأیید ۶ رقمی به شماره ثبت‌شده مدیر کل (${maskedPhone}) ارسال شد.`
          : smsResult.message,
      },
      smsResult.success ? 200 : 400,
    );
  }

  if (pathname === "/api/admin/change-password" && method === "POST") {
    const parsed = await parseJson(
      request,
      z.object({
        otpCode: z.string().min(5, "کد تأیید باید ۶ رقم باشد").max(6, "کد تأیید باید ۶ رقم باشد"),
        newPassword: z.string().min(8, "رمز عبور جدید مدیر باید حداقل ۸ کاراکتر باشد"),
        method: z.enum(["sms", "email"]).optional(),
      }),
    );
    if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

    const cleanOtp = toAsciiDigits(parsed.data.otpCode).trim();
    const adminPhone = getAdminPhoneForOtp();
    const adminEmail = getAdminRecoveryEmail();

    let verifyRes: { success: boolean; message: string };
    if (parsed.data.method === "email") {
      if (!adminEmail) {
        return jsonResponse(
          {
            success: false,
            message: "ایمیل بازیابی مدیر (ADMIN_RECOVERY_EMAIL) در تنظیمات کلودفلر تعریف نشده است.",
          },
          400,
        );
      }
      verifyRes = await verifyEmailOtpCode(adminEmail, cleanOtp);
    } else if (parsed.data.method === "sms") {
      verifyRes = await verifyOtpCode(adminPhone, cleanOtp);
    } else {
      verifyRes = await verifyOtpCode(adminPhone, cleanOtp);
      if (!verifyRes.success && adminEmail) {
        verifyRes = await verifyEmailOtpCode(adminEmail, cleanOtp);
      }
    }

    if (!verifyRes.success) return jsonResponse({ success: false, message: verifyRes.message }, 400);

    await setAdminPassword(parsed.data.newPassword);
    await recordAuditLog({
      actorUserId: "admin_user_main",
      actorRole: "main_admin",
      action: "admin_password_changed",
      targetType: "admin_settings",
      targetId: "admin_password",
      details: `تغییر رمز مدیر کل از طریق ${parsed.data.method === "email" ? "ایمیل" : "پیامک"}`,
    });

    return jsonResponse({
      success: true,
      message: "رمز عبور مدیر با موفقیت تغییر یافت. برای ورودهای بعدی از رمز عبور جدید استفاده کنید.",
    });
  }

  // ==========================================
  // Admin Protected Endpoints (Require Valid Admin Session)
  // ==========================================

  if (pathname.startsWith("/api/admin/")) {
    const session = await getRequestSession(request);
    if (!isAdminSession(session)) {
      return jsonResponse({ success: false, message: "دسترسی غیرمجاز؛ فقط مدیران مجاز هستند." }, 403);
    }

    if (pathname === "/api/admin/pending-requests" && method === "GET") {
      const requests = await getPendingRoleRequests();
      return jsonResponse({ success: true, requests });
    }

    if (pathname === "/api/admin/approve-request" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({ roleId: z.string().min(1), action: z.enum(["approved", "rejected"]) }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

      const success = await updateRoleApprovalStatus(
        parsed.data.roleId,
        parsed.data.action,
        session!.user.id,
      );
      return jsonResponse({
        success,
        message:
          parsed.data.action === "approved"
            ? "عضویت و دسترسی با موفقیت تأیید شد."
            : "درخواست عضویت رد شد.",
      });
    }

    if (pathname === "/api/admin/dashboard-data" && method === "GET") {
      const data = await getAdminDashboardData();
      return jsonResponse({ success: true, ...data });
    }

    if (pathname === "/api/admin/member-action" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({
          memberId: z.string().min(1),
          action: z.enum(["edit", "archive", "restore"]),
          data: z
            .object({
              fullName: z.string().optional(),
              phone: z.string().optional(),
              email: z.string().optional(),
              city: z.string().optional(),
              province: z.string().optional(),
              role: z.string().optional(),
              verificationStatus: z.string().optional(),
            })
            .optional(),
        }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);

      const ok = await adminUpdateMember({
        ...parsed.data,
        actorUserId: session!.user.id,
      });
      return jsonResponse({ success: ok, message: ok ? "اطلاعات عضو به‌روزرسانی شد." : "عضو پیدا نشد." });
    }

    if (pathname === "/api/admin/load-action" && method === "POST") {
      const body = (await request.json().catch(() => null)) as any;
      if (!body?.loadId || !body?.action) {
        return jsonResponse({ success: false, message: "شناسه بار و عملیات الزامی است." }, 400);
      }

      if (body.action === "approve") {
        await updateLoadStatusInDatabase(body.loadId, "active");
      } else if (body.action === "reject") {
        await updateLoadStatusInDatabase(body.loadId, "rejected");
      } else if (body.action === "inactive") {
        await updateLoadStatusInDatabase(body.loadId, "inactive");
      } else if (body.action === "archive") {
        await deleteLoadFromDatabase(body.loadId, true);
      } else if (body.action === "delete") {
        await deleteLoadFromDatabase(body.loadId, false);
      } else if (body.action === "edit" && body.load) {
        await syncLoadToDatabase({ ...body.load, id: body.loadId });
      }

      await recordAuditLog({
        actorUserId: session!.user.id,
        actorRole: session!.roles.join(","),
        action: `admin_load_${body.action}`,
        targetType: "load",
        targetId: body.loadId,
      });

      return jsonResponse({ success: true, message: "عملیات روی بار انجام شد." });
    }

    if (pathname === "/api/admin/city-manager" && method === "POST") {
      if (!isMainAdminSession(session)) {
        return jsonResponse({ success: false, message: "فقط مدیر کل مجاز به مدیریت مدیران شهری است." }, 403);
      }
      const body = (await request.json().catch(() => ({}))) as any;
      const res = await adminManageCityManager({
        action: body.action,
        memberId: body.memberId,
        adminUserId: body.adminUserId,
        cities: body.cities,
        password: body.password,
        actorUserId: session!.user.id,
      });
      return jsonResponse(res, res.success ? 200 : 400);
    }

    if (pathname === "/api/admin/city-neighbor" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({ cityName: z.string().min(1), neighborCityName: z.string().min(1), isEnabled: z.boolean() }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
      await toggleCityNeighbor(parsed.data.cityName, parsed.data.neighborCityName, parsed.data.isEnabled);
      return jsonResponse({ success: true, message: "دسترسی شهر همجوار به‌روزرسانی شد." });
    }

    if (pathname === "/api/admin/finance/verify-bank" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({ memberId: z.string().min(1), status: z.enum(["verified", "rejected"]) }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
      const ok = await adminVerifyBankAccount(parsed.data.memberId, parsed.data.status, session!.user.id);
      return jsonResponse({ success: ok, message: "وضعیت شبا ثبت شد." });
    }

    if (pathname === "/api/admin/finance/create-payout" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({
          memberId: z.string().min(1),
          amount: z.number().positive(),
          description: z.string().optional(),
          referenceCode: z.string().optional(),
        }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
      const tx = await adminCreatePayout({ ...parsed.data, actorUserId: session!.user.id });
      return jsonResponse({ success: true, transaction: tx, message: "سند پرداخت ثبت شد." });
    }

    if (pathname === "/api/admin/finance/update-payout" && method === "POST") {
      const parsed = await parseJson(
        request,
        z.object({
          transactionId: z.string().min(1),
          status: z.enum(["settled", "failed", "cancelled"]),
          referenceCode: z.string().optional(),
        }),
      );
      if (parsed.error || !parsed.data) return jsonResponse({ success: false, message: parsed.error }, 400);
      const ok = await adminUpdatePayoutStatus({ ...parsed.data, actorUserId: session!.user.id });
      return jsonResponse({ success: ok, message: ok ? "وضعیت پرداخت به‌روزرسانی شد." : "تراکنش پیدا نشد." });
    }

    if (pathname === "/api/admin/db-stats" && method === "GET") {
      const stats = await getDatabaseStats();
      return jsonResponse({ success: true, stats });
    }

    if (pathname === "/api/admin/backup-db" && method === "GET") {
      const binary = getSqliteDatabaseBinary();
      const dateStr = new Date().toISOString().slice(0, 10);
      if (binary && Buffer.isBuffer(binary) && binary.length > 0) {
        return new Response(new Uint8Array(binary), {
          status: 200,
          headers: {
            "content-type": "application/x-sqlite3",
            "content-disposition": `attachment; filename="terrabar-database-${dateStr}.sqlite"`,
            "content-length": String(binary.length),
          },
        });
      }
      const sql = await exportDatabaseAsSql();
      return new Response(sql, {
        status: 200,
        headers: {
          "content-type": "application/sql; charset=utf-8",
          "content-disposition": `attachment; filename="terrabar-database-${dateStr}.sql"`,
        },
      });
    }

    if (pathname === "/api/admin/export-sql" && method === "GET") {
      const sql = await exportDatabaseAsSql();
      const dateStr = new Date().toISOString().slice(0, 10);
      return new Response(sql, {
        status: 200,
        headers: {
          "content-type": "application/sql; charset=utf-8",
          "content-disposition": `attachment; filename="terrabar-backup-${dateStr}.sql"`,
        },
      });
    }

    if (pathname === "/api/admin/export-json" && method === "GET") {
      const json = await exportDatabaseAsJson();
      const dateStr = new Date().toISOString().slice(0, 10);
      return new Response(JSON.stringify(json, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="terrabar-backup-${dateStr}.json"`,
        },
      });
    }
  }

  return jsonResponse({ success: false, message: "مسیر API مورد نظر یافت نشد." }, 404);
}
