/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Eye,
  FileArchive,
  HardDrive,
  KeyRound,
  Landmark,
  Lock,
  MapPinned,
  MessageSquare,
  Package,
  Phone,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CityPicker } from "@/components/city-picker";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api-client";
import { cities, faNumber, pageHead, provinces } from "@/lib/marketplace";

export const Route = createFileRoute("/admin")({
  head: () =>
    pageHead("پنل مدیریت ترابار", "مدیریت جامع اعضا، بارها، سفارش‌ها، امور مالی، مدیران شهر و پشتیبان‌گیری."),
  component: AdminPage,
});

const roleLabels: Record<string, string> = {
  admin: "مدیر کل",
  main_admin: "مدیر کل",
  city_manager: "مدیر شهر",
  supplier: "تأمین‌کننده",
  seller: "بارفروش",
  bar_seller: "بارفروش",
  special_buyer: "خریدار ویژه",
  buyer_special: "خریدار ویژه",
  buyer: "خریدار",
};

const qualityLabels: Record<string, string> = {
  premium: "ممتاز (ویژه)",
  standard: "استاندارد",
  economy: "اقتصادی",
  negotiated: "توافقی",
};

const orderStatusLabels: Record<string, string> = {
  pending: "در انتظار تأیید فروشنده",
  accepted: "تأییدشده",
  rejected: "ردشده",
};

const paymentStatusLabels: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  failed: "ناموفق",
  refunded: "بازپرداخت‌شده",
};

const deliveryStatusLabels: Record<string, string> = {
  awaiting_payment: "در انتظار پرداخت",
  awaiting_dispatch: "آماده ارسال",
  shipped: "ارسال‌شده",
  delivered: "تحویل‌شده",
  disputed: "اختلاف",
};

const purchaseStatusLabels: Record<string, string> = {
  open: "باز / در حال بررسی",
  matched: "تأمین و تطبیق‌شده",
  closed: "بسته‌شده (تکمیل)",
  cancelled: "لغوشده",
};

type AdminTab =
  | "requests"
  | "loads"
  | "allloads"
  | "members"
  | "orders"
  | "purchases"
  | "finance"
  | "managers"
  | "smslogs"
  | "reviews"
  | "visits"
  | "security"
  | "backup";

type MemberRequest = {
  id: string;
  member_id: string;
  role_code: string;
  approval_status: string;
  created_at: string;
  request_note?: string | null;
  member_name?: string;
  member_phone?: string;
  member_city?: string;
  member_province?: string;
};

type CityMember = {
  id: string;
  auth_user_id?: string;
  full_name: string;
  phone: string | null;
  email?: string | null;
  city: string;
  province?: string;
  role: string;
  verification_status: string | null;
  joined_at?: string;
  created_at?: string;
  is_archived: number | boolean;
  member_roles?: { id: string; role_code: string; approval_status: string }[];
};

type AdminLoad = {
  id: string;
  member_id: string;
  name: string;
  product_type?: string;
  engine: string | null;
  quality: string | null;
  city: string;
  origin?: string | null;
  price: number;
  count: number | null;
  quantity: number;
  unit: string;
  package_type?: string | null;
  package_weight?: number | null;
  sale_type?: string | null;
  status: string;
  created_at: string;
  archived_at: string | null;
  member_name?: string | null;
  member_phone?: string | null;
  description?: string | null;
};

type AdminOrder = {
  id: string;
  invoice_number: number;
  customer_name: string;
  customer_phone?: string | null;
  customer_city: string;
  quantity: number;
  unit: string;
  price: number;
  total_price: number;
  status: string;
  payment_status: string;
  delivery_status: string;
  delivery_type?: string | null;
  created_at: string;
};

type AdminPurchaseRequest = {
  id: string;
  request_number: number;
  product_type: string;
  quantity: number;
  quantity_unit: string;
  destination_city: string | null;
  quality_requirements: string | null;
  needed_by: string | null;
  notes: string | null;
  status: string;
  buyer_name?: string | null;
  buyer_phone?: string | null;
  created_at: string;
};

type CityManager = {
  id: string;
  auth_user_id: string;
  display_name: string;
  login_username: string;
  city: string;
  admin_role: string;
  is_active: number | boolean;
};

type AdminUserCity = {
  id: string;
  admin_user_id: string;
  city_name: string;
};

type CityNeighbor = {
  id: string;
  city_name: string;
  neighbor_city_name: string;
  is_enabled: number | boolean;
};

type SiteVisit = {
  id: string;
  user_id: string | null;
  route: string;
  visited_at?: string;
  created_at?: string;
  full_name?: string | null;
  phone?: string | null;
  city?: string | null;
};

type AdminRating = {
  id: string;
  order_id: string;
  reviewer_member_id: string;
  target_type: string;
  score: number;
  review_text: string | null;
  created_at: string;
};

type RatingMessage = {
  id: string;
  rating_id: string;
  sender_user_id: string;
  message: string;
  created_at: string;
};

type AdminBankAccount = {
  id: string;
  member_id: string;
  bank_name: string;
  account_holder_name: string;
  iban: string;
  verification_status: string;
  member_name?: string | null;
  member_phone?: string | null;
};

type AdminFinanceTransaction = {
  id: string;
  member_id: string;
  order_id: string | null;
  transaction_type: string;
  amount: number;
  description: string;
  reference_code: string | null;
  transaction_date: string;
  payout_status: string;
  member_name?: string | null;
};

type PlatformFinanceEntry = {
  id: string;
  entry_type: string;
  entry_status: string;
  amount: number;
  currency: string;
  order_id: string | null;
  member_id: string | null;
  provider: string | null;
  external_reference: string | null;
  description: string;
  created_at: string;
};

type SmsLog = {
  id: string;
  recipient: string;
  channel: string;
  event_type: string;
  message_summary: string;
  status: string;
  error_message?: string | null;
  created_at: string;
};

type AuditLog = {
  id: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  details?: string | null;
  created_at: string;
};

type PerformanceStats = {
  totalMembers: number;
  approvedMembers: number;
  activeLoads: number;
  pendingLoads: number;
  totalOrders: number;
  paidOrders: number;
  totalSalesAmount: number;
  settledSalesAmount: number;
  totalCommissionAmount: number;
  totalVisits: number;
  sentSmsCount: number;
  failedSmsCount: number;
};

function AdminPage() {
  const { user, loading, isAdmin, roles } = useAuth();
  const canManage = isAdmin || roles.includes("city_manager");
  const [tab, setTab] = useState<AdminTab>("requests");

  const [requests, setRequests] = useState<MemberRequest[]>([]);
  const [members, setMembers] = useState<CityMember[]>([]);
  const [loads, setLoads] = useState<AdminLoad[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<AdminPurchaseRequest[]>([]);
  const [ratings, setRatings] = useState<AdminRating[]>([]);
  const [ratingMessages, setRatingMessages] = useState<Record<string, RatingMessage[]>>({});
  const [ratingReplies, setRatingReplies] = useState<Record<string, string>>({});
  const [recentVisits, setRecentVisits] = useState<SiteVisit[]>([]);
  const [bankAccounts, setBankAccounts] = useState<AdminBankAccount[]>([]);
  const [financeTransactions, setFinanceTransactions] = useState<AdminFinanceTransaction[]>([]);
  const [platformLedger, setPlatformLedger] = useState<PlatformFinanceEntry[]>([]);
  const [adminUsers, setAdminUsers] = useState<CityManager[]>([]);
  const [adminUserCities, setAdminUserCities] = useState<AdminUserCity[]>([]);
  const [cityNeighbors, setCityNeighbors] = useState<CityNeighbor[]>([]);
  const [smsLogs, setSmsLogs] = useState<SmsLog[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [perfStats, setPerfStats] = useState<PerformanceStats | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState("");

  // Member inline edit state
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberEditForm, setMemberEditForm] = useState({
    fullName: "",
    phone: "",
    email: "",
    city: "",
    province: "",
    role: "buyer",
    verificationStatus: "approved",
  });

  // Load inline edit state
  const [editingLoadId, setEditingLoadId] = useState<string | null>(null);
  const [loadEditForm, setLoadEditForm] = useState({
    product_type: "",
    engine: "",
    city: "",
    origin: "",
    quality: "standard",
    price: "",
    count: "",
    package_weight: "",
    status: "active",
  });

  // City manager assignment & neighbor state
  const [selectedManagerMemberId, setSelectedManagerMemberId] = useState("");
  const [selectedManagerCity, setSelectedManagerCity] = useState("");
  const [managerExtraCities, setManagerExtraCities] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerBusy, setManagerBusy] = useState(false);

  const [neighborCityA, setNeighborCityA] = useState("تهران");
  const [neighborCityB, setNeighborCityB] = useState("کرج");

  // Finance payout controls
  const [payoutAmounts, setPayoutAmounts] = useState<Record<string, string>>({});
  const [payoutReferences, setPayoutReferences] = useState<Record<string, string>>({});
  const [financeBusy, setFinanceBusy] = useState(false);

  // Admin password change state
  const [securityOtpSent, setSecurityOtpSent] = useState(false);
  const [securityOtpCode, setSecurityOtpCode] = useState("");
  const [securityNewPassword, setSecurityNewPassword] = useState("");
  const [securityConfirmPassword, setSecurityConfirmPassword] = useState("");
  const [securityBusy, setSecurityBusy] = useState(false);
  const [securityError, setSecurityError] = useState("");
  const [securityNotice, setSecurityNotice] = useState("");

  // DB Backup stats
  const [dbStats, setDbStats] = useState<any>(null);
  const [loadingDbStats, setLoadingDbStats] = useState(false);

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setRefreshing(true);
    const res = await apiGet<any>("/api/admin/dashboard-data");
    setRefreshing(false);
    if (!res.ok || !res.data?.success) {
      return;
    }
    const d = res.data;
    setRequests(d.pendingRoleRequests || []);
    setMembers(d.members || []);
    setLoads(d.loads || []);
    setOrders(d.orders || []);
    setPurchaseRequests(d.purchaseRequests || []);
    setRatings(d.ratings || []);
    setRecentVisits(d.recentVisits || []);
    setBankAccounts(d.bankAccounts || []);
    setFinanceTransactions(d.financeTransactions || []);
    setPlatformLedger(d.platformLedger || []);
    setAdminUsers(d.adminUsers || []);
    setAdminUserCities(d.adminUserCities || []);
    setCityNeighbors(d.cityNeighbors || []);
    setSmsLogs(d.smsLogs || []);
    setAuditLogs(d.auditLogs || []);
    setPerfStats(d.performanceStats || null);
  }, [canManage]);

  useEffect(() => {
    if (!canManage) return;
    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 15000);
    const onReq = () => void refresh();
    window.addEventListener("terrabar-request-submitted", onReq);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("terrabar-request-submitted", onReq);
    };
  }, [canManage, refresh]);

  async function fetchDbStats() {
    setLoadingDbStats(true);
    const res = await apiGet<any>("/api/admin/db-stats");
    setLoadingDbStats(false);
    if (res.ok && res.data?.success && res.data.stats) {
      setDbStats(res.data.stats);
    }
  }

  async function handleApproveRequest(request: MemberRequest, action: "approved" | "rejected") {
    setBusyId(request.id);
    const res = await apiPost("/api/admin/approve-request", { roleId: request.id, action });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success(
        action === "approved"
          ? "عضویت و امکانات فروش با موفقیت تأیید شد."
          : "درخواست عضویت رد شد.",
      );
      void refresh();
    } else {
      toast.error(res.data?.message || "به‌روزرسانی وضعیت درخواست انجام نشد.");
    }
  }

  async function handleMemberAction(memberId: string, action: "archive" | "restore") {
    if (
      action === "archive" &&
      !window.confirm("آیا از بایگانی کردن این عضو مطمئن هستید؟ سوابق مالی و سفارش‌ها محفوظ می‌مانند.")
    ) {
      return;
    }
    setBusyId(memberId);
    const res = await apiPost("/api/admin/member-action", { memberId, action });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success(action === "archive" ? "عضو بایگانی شد." : "عضو با موفقیت بازگردانی شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "عملیات روی عضو انجام نشد.");
    }
  }

  async function submitMemberEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingMemberId) return;
    setBusyId(editingMemberId);
    const res = await apiPost("/api/admin/member-action", {
      memberId: editingMemberId,
      action: "edit",
      data: memberEditForm,
    });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success("مشخصات عضو با موفقیت ویرایش شد.");
      setEditingMemberId(null);
      void refresh();
    } else {
      toast.error(res.data?.message || "ذخیره تغییرات عضو انجام نشد.");
    }
  }

  async function handleLoadAction(
    loadId: string,
    action: "approve" | "reject" | "inactive" | "archive" | "delete",
  ) {
    if (
      (action === "delete" || action === "archive") &&
      !window.confirm(action === "delete" ? "بار به‌صورت کامل حذف شود؟" : "بار بایگانی شود؟")
    ) {
      return;
    }
    setBusyId(loadId);
    const res = await apiPost("/api/admin/load-action", { loadId, action });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success(res.data?.message || "عملیات روی بار انجام شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "عملیات روی بار انجام نشد.");
    }
  }

  async function submitLoadEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLoadId) return;
    const orig = loads.find((l) => l.id === editingLoadId);
    const price = Number(loadEditForm.price);
    const count = Number(loadEditForm.count);
    const pkgWeight = Number(loadEditForm.package_weight) || Number(orig?.package_weight) || 10;
    if (!loadEditForm.product_type.trim() || !Number.isFinite(price) || price <= 0 || count < 0) {
      toast.error("مقادیر نام محصول، قیمت و تعداد بسته را به درستی وارد کنید.");
      return;
    }
    setBusyId(editingLoadId);
    const res = await apiPost("/api/admin/load-action", {
      loadId: editingLoadId,
      action: "edit",
      load: {
        ...orig,
        id: editingLoadId,
        name: [loadEditForm.product_type.trim(), loadEditForm.engine.trim()].filter(Boolean).join(" "),
        product_type: loadEditForm.product_type.trim(),
        engine: loadEditForm.engine.trim() || null,
        city: loadEditForm.city.trim(),
        origin: loadEditForm.origin.trim(),
        quality: loadEditForm.quality,
        price,
        count,
        package_weight: pkgWeight,
        quantity: count * pkgWeight,
        status: loadEditForm.status,
      },
    });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success("اطلاعات بار با موفقیت ویرایش شد.");
      setEditingLoadId(null);
      void refresh();
    } else {
      toast.error(res.data?.message || "ویرایش بار انجام نشد.");
    }
  }

  async function handleOrderAction(
    orderId: string,
    action: "accept" | "reject" | "ship" | "deliver" | "mark_paid",
  ) {
    setBusyId(orderId);
    const res = await apiPost("/api/orders/update-status", { orderId, action });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success(res.data?.message || "وضعیت سفارش به‌روزرسانی شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "تغییر وضعیت سفارش انجام نشد.");
    }
  }

  async function updatePurchaseStatus(
    request: AdminPurchaseRequest,
    status: "open" | "matched" | "closed" | "cancelled",
  ) {
    setBusyId(request.id);
    const res = await apiPost("/api/purchase-requests/update-status", { id: request.id, status });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success("وضعیت درخواست خرید تغییر کرد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "به‌روزرسانی وضعیت درخواست خرید انجام نشد.");
    }
  }

  async function verifyBankAccount(account: AdminBankAccount, status: "verified" | "rejected") {
    setFinanceBusy(true);
    const res = await apiPost("/api/admin/finance/verify-bank", {
      memberId: account.member_id,
      status,
    });
    setFinanceBusy(false);
    if (res.ok && res.data?.success) {
      toast.success(status === "verified" ? "شماره شبای فروشنده تأیید شد." : "شماره شبا رد شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "تغییر وضعیت حساب بانکی انجام نشد.");
    }
  }

  async function createSellerPayout(memberId: string) {
    const amount = Number(payoutAmounts[memberId] ?? "");
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("مبلغ تسویه را به‌صورت عدد مثبت وارد کنید.");
      return;
    }
    setFinanceBusy(true);
    const res = await apiPost("/api/admin/finance/create-payout", {
      memberId,
      amount,
      referenceCode: (payoutReferences[memberId] ?? "").trim() || undefined,
      description: "تسویه فروشنده ثبت‌شده توسط مدیر کل",
    });
    setFinanceBusy(false);
    if (res.ok && res.data?.success) {
      toast.success("سند تسویه در وضعیت «در انتظار» ثبت شد.");
      setPayoutAmounts((prev) => ({ ...prev, [memberId]: "" }));
      void refresh();
    } else {
      toast.error(res.data?.message || "ثبت تسویه انجام نشد.");
    }
  }

  async function updateSellerPayout(
    tx: AdminFinanceTransaction,
    status: "settled" | "failed" | "cancelled",
  ) {
    if (
      status === "settled" &&
      !window.confirm(
        "آیا انتقال واقعی وجه به شبای فروشنده انجام و شناسه پیگیری بانکی ثبت شده است؟",
      )
    ) {
      return;
    }
    setFinanceBusy(true);
    const res = await apiPost("/api/admin/finance/update-payout", {
      transactionId: tx.id,
      status,
      referenceCode: (payoutReferences[tx.id] ?? "").trim() || tx.reference_code || undefined,
    });
    setFinanceBusy(false);
    if (res.ok && res.data?.success) {
      toast.success("وضعیت تسویه حساب به‌روزرسانی شد و پیامک اطلاع‌رسانی ارسال گردید.");
      void refresh();
    } else {
      toast.error(res.data?.message || "به‌روزرسانی وضعیت تسویه انجام نشد.");
    }
  }

  async function saveCityManager(e: React.FormEvent) {
    e.preventDefault();
    const cityList = [
      selectedManagerCity.trim(),
      ...managerExtraCities
        .split(/[،,]/)
        .map((c) => c.trim())
        .filter(Boolean),
    ].filter(Boolean);

    if (!selectedManagerMemberId || !cityList.length) {
      toast.error("لطفاً عضو و حداقل یک شهر تحت مدیریت را انتخاب کنید.");
      return;
    }
    if (managerPassword && managerPassword.length < 8) {
      toast.error("رمز عبور مدیر شهر باید حداقل ۸ کاراکتر باشد.");
      return;
    }

    setManagerBusy(true);
    const res = await apiPost("/api/admin/city-manager", {
      action: "assign",
      memberId: selectedManagerMemberId,
      cities: [...new Set(cityList)],
      password: managerPassword || undefined,
    });
    setManagerBusy(false);
    if (res.ok && res.data?.success) {
      toast.success(res.data.message || "مدیر شهر ثبت شد.");
      setManagerPassword("");
      setManagerExtraCities("");
      void refresh();
    } else {
      toast.error(res.data?.message || "ثبت مدیر شهر انجام نشد.");
    }
  }

  async function deactivateCityManager(manager: CityManager) {
    if (!window.confirm(`دسترسی مدیریتی ${manager.display_name} غیرفعال شود؟`)) return;
    setManagerBusy(true);
    const res = await apiPost("/api/admin/city-manager", {
      action: "deactivate",
      adminUserId: manager.id,
    });
    setManagerBusy(false);
    if (res.ok && res.data?.success) {
      toast.success("دسترسی مدیر شهر غیرفعال شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "غیرفعال‌سازی مدیر شهر انجام نشد.");
    }
  }

  async function handleToggleCityNeighbor(cityName: string, neighborCityName: string, isEnabled: boolean) {
    if (!cityName.trim() || !neighborCityName.trim() || cityName.trim() === neighborCityName.trim()) {
      toast.error("دو شهر متفاوت انتخاب کنید.");
      return;
    }
    const res = await apiPost("/api/admin/city-neighbor", {
      cityName: cityName.trim(),
      neighborCityName: neighborCityName.trim(),
      isEnabled,
    });
    if (res.ok && res.data?.success) {
      toast.success(isEnabled ? "ارتباط شهر همجوار فعال شد." : "ارتباط شهر همجوار غیرفعال شد.");
      void refresh();
    } else {
      toast.error(res.data?.message || "به‌روزرسانی شهر همجوار انجام نشد.");
    }
  }

  async function loadMessagesForRating(ratingId: string) {
    const res = await apiGet<{ success?: boolean; messages?: RatingMessage[] }>(
      `/api/ratings/messages?ratingId=${encodeURIComponent(ratingId)}`,
    );
    if (res.ok && res.data?.messages) {
      setRatingMessages((prev) => ({ ...prev, [ratingId]: res.data.messages! }));
    }
  }

  async function sendRatingReply(ratingId: string) {
    const msg = (ratingReplies[ratingId] ?? "").trim();
    if (!msg) return;
    setBusyId(ratingId);
    const res = await apiPost("/api/ratings/send-message", { ratingId, message: msg });
    setBusyId("");
    if (res.ok && res.data?.success) {
      toast.success("پاسخ شما ثبت شد.");
      setRatingReplies((prev) => ({ ...prev, [ratingId]: "" }));
      void loadMessagesForRating(ratingId);
    } else {
      toast.error(res.data?.message || "ارسال پاسخ انجام نشد.");
    }
  }

  async function handleSendAdminOtp() {
    setSecurityBusy(true);
    setSecurityError("");
    setSecurityNotice("");
    const res = await apiPost("/api/admin/request-password-otp", {});
    setSecurityBusy(false);
    if (res.ok && res.data?.success) {
      setSecurityOtpSent(true);
      setSecurityNotice(res.data.message || "کد تأیید ۶ رقمی به شماره مدیر کل پیامک شد.");
    } else {
      setSecurityError(res.data?.message || "خطا در ارسال پیامک تأیید.");
    }
  }

  async function handleChangeAdminPassword(e: React.FormEvent) {
    e.preventDefault();
    setSecurityError("");
    setSecurityNotice("");
    if (securityOtpCode.length !== 6) {
      setSecurityError("کد تأیید ۶ رقمی پیامک‌شده را وارد نمایید.");
      return;
    }
    if (securityNewPassword.length < 8) {
      setSecurityError("رمز عبور جدید مدیر باید حداقل ۸ کاراکتر باشد.");
      return;
    }
    if (securityNewPassword !== securityConfirmPassword) {
      setSecurityError("رمز عبور جدید با تکرار آن یکسان نیست.");
      return;
    }
    setSecurityBusy(true);
    const res = await apiPost("/api/admin/change-password", {
      otpCode: securityOtpCode.trim(),
      newPassword: securityNewPassword.trim(),
    });
    setSecurityBusy(false);
    if (res.ok && res.data?.success) {
      setSecurityNotice(res.data.message || "رمز عبور مدیر با موفقیت تغییر یافت.");
      setSecurityOtpCode("");
      setSecurityNewPassword("");
      setSecurityConfirmPassword("");
      setSecurityOtpSent(false);
    } else {
      setSecurityError(res.data?.message || "خطا در تغییر رمز عبور.");
    }
  }

  if (loading) {
    return <section className="py-16 text-center text-sm text-muted-foreground">در حال بارگذاری…</section>;
  }

  if (!user || !canManage) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-md text-center">
          <ShieldAlert className="mx-auto mb-4 size-12 text-warning" />
          <h1 className="text-2xl font-extrabold">دسترسی محدود به مدیران</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            این بخش فقط برای مدیر کل و مدیران شهری ترابار فعال است.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/admin-login">ورود مدیر ترابار</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">بازگشت به بازار</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const pendingLoads = loads.filter((l) => l.status === "pending");

  return (
    <section className="bg-market-surface py-10">
      <div className="site-container">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-extrabold sm:text-3xl">پنل مدیریت ترابار</h1>
            {!isAdmin && (
              <p className="mt-1 text-sm text-muted-foreground">
                دسترسی شما به عنوان مدیر شهر به عملیات شهرهای تخصیص‌یافته محدود است.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={refreshing}
            onClick={() => {
              void refresh();
              toast.info("اطلاعات داشبورد به‌روزرسانی شد.");
            }}
            className="gap-2 rounded-xl"
          >
            <RefreshCw className={`size-4 text-primary ${refreshing ? "animate-spin" : ""}`} />
            <span>بروزرسانی داده‌ها</span>
          </Button>
        </div>

        {/* KPI Overview Strip */}
        {perfStats && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">کل اعضا / تأییدشده</p>
              <p className="mt-1.5 text-lg font-extrabold">
                {faNumber(perfStats.totalMembers)} / {faNumber(perfStats.approvedMembers)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">بارهای فعال</p>
              <p className="mt-1.5 text-lg font-extrabold text-emerald-600">
                {faNumber(perfStats.activeLoads)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">سفارش‌ها / تسویه‌شده</p>
              <p className="mt-1.5 text-lg font-extrabold">
                {faNumber(perfStats.totalOrders)} / {faNumber(perfStats.paidOrders)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">فروش قطعی</p>
              <p className="mt-1.5 text-base font-extrabold">
                {faNumber(perfStats.settledSalesAmount)} تومان
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">کمیسیون ۵٪ پلتفرم</p>
              <p className="mt-1.5 text-base font-extrabold text-primary">
                {faNumber(perfStats.totalCommissionAmount)} تومان
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <p className="text-xs text-muted-foreground">پیامک موفق / ناموفق</p>
              <p className="mt-1.5 text-lg font-extrabold">
                {faNumber(perfStats.sentSmsCount)} /{" "}
                <span className="text-destructive">{faNumber(perfStats.failedSmsCount)}</span>
              </p>
            </div>
          </div>
        )}

        {/* Urgent pending role requests banner */}
        {requests.length > 0 && (
          <div className="mt-6 rounded-2xl border-2 border-amber-500 bg-amber-50/70 p-4 shadow-sm dark:bg-amber-950/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-amber-950 dark:text-amber-100">
                  {faNumber(requests.length)} درخواست عضویت حرفه‌ای در انتظار بررسی شماست
                </h2>
                <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">
                  با تأیید هر درخواست، قفل بخش اعلام بار و خرید ویژه برای کاربر باز می‌شود.
                </p>
              </div>
              {tab !== "requests" && (
                <Button size="sm" onClick={() => setTab("requests")}>
                  مشاهده درخواست‌ها
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="mt-6 flex flex-wrap items-center gap-2 border-b border-border pb-3">
          <Button variant={tab === "requests" ? "default" : "ghost"} onClick={() => setTab("requests")}>
            <Users className="size-4" />
            درخواست‌های عضویت ({faNumber(requests.length)})
          </Button>
          <Button variant={tab === "loads" ? "default" : "ghost"} onClick={() => setTab("loads")}>
            <Package className="size-4" />
            بارهای در انتظار ({faNumber(pendingLoads.length)})
          </Button>
          <Button variant={tab === "allloads" ? "default" : "ghost"} onClick={() => setTab("allloads")}>
            <Package className="size-4" />
            همه بارها ({faNumber(loads.length)})
          </Button>
          <Button variant={tab === "members" ? "default" : "ghost"} onClick={() => setTab("members")}>
            <Users className="size-4" />
            اعضا ({faNumber(members.length)})
          </Button>
          <Button variant={tab === "orders" ? "default" : "ghost"} onClick={() => setTab("orders")}>
            سفارش‌ها ({faNumber(orders.length)})
          </Button>
          <Button variant={tab === "purchases" ? "default" : "ghost"} onClick={() => setTab("purchases")}>
            درخواست‌های خرید ({faNumber(purchaseRequests.length)})
          </Button>
          {isAdmin && (
            <>
              <Button variant={tab === "finance" ? "default" : "ghost"} onClick={() => setTab("finance")}>
                <Wallet className="size-4" />
                امور مالی و تسویه
              </Button>
              <Button variant={tab === "managers" ? "default" : "ghost"} onClick={() => setTab("managers")}>
                <MapPinned className="size-4" />
                مدیران شهر و همجوارها
              </Button>
              <Button variant={tab === "smslogs" ? "default" : "ghost"} onClick={() => setTab("smslogs")}>
                <Activity className="size-4" />
                لاگ پیامک و عملیات ({faNumber(smsLogs.length)})
              </Button>
              <Button variant={tab === "reviews" ? "default" : "ghost"} onClick={() => setTab("reviews")}>
                <MessageSquare className="size-4" />
                نظرات ({faNumber(ratings.length)})
              </Button>
              <Button variant={tab === "visits" ? "default" : "ghost"} onClick={() => setTab("visits")}>
                <Eye className="size-4" />
                بازدیدها ({faNumber(recentVisits.length)})
              </Button>
              <Button variant={tab === "security" ? "default" : "ghost"} onClick={() => setTab("security")}>
                <KeyRound className="size-4" />
                امنیت و رمز
              </Button>
              <Button
                variant={tab === "backup" ? "default" : "ghost"}
                onClick={() => {
                  setTab("backup");
                  void fetchDbStats();
                }}
              >
                <Database className="size-4" />
                پشتیبان‌گیری دیتابیس
              </Button>
            </>
          )}
        </div>

        {/* TAB: MEMBERSHIP REQUESTS */}
        {tab === "requests" && (
          <div className="mt-6 grid gap-4">
            {requests.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                درخواست عضویت در انتظاری وجود ندارد.
              </p>
            ) : (
              requests.map((req) => (
                <div key={req.id} className="rounded-xl border border-border bg-card p-5 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-base">{req.member_name || "کاربر بدون نام"}</strong>
                      <span className="rounded-lg bg-secondary px-2.5 py-1 text-xs font-bold">
                        {roleLabels[req.role_code] || req.role_code}
                      </span>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {req.member_phone || "—"}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    شهر: {req.member_city || req.member_province || "ثبت‌نشده"} · تاریخ ثبت:{" "}
                    {new Date(req.created_at).toLocaleString("fa-IR")}
                  </p>
                  {req.request_note && (
                    <p className="mt-3 rounded-lg bg-muted/50 p-3 text-xs leading-6">{req.request_note}</p>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === req.id}
                      onClick={() => void handleApproveRequest(req, "approved")}
                    >
                      <CheckCircle2 className="ml-1 size-4" />
                      تأیید و فعال‌سازی نقش
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === req.id}
                      onClick={() => void handleApproveRequest(req, "rejected")}
                    >
                      <XCircle className="ml-1 size-4" />
                      رد درخواست
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: PENDING LOADS */}
        {tab === "loads" && (
          <div className="mt-6 grid gap-4">
            {pendingLoads.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                بار در انتظار تأییدی وجود ندارد.
              </p>
            ) : (
              pendingLoads.map((load) => (
                <div
                  key={load.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5"
                >
                  <div>
                    <strong>
                      {load.name} {load.engine || ""}
                    </strong>
                    <span className="mr-2 rounded bg-secondary px-2 py-0.5 text-xs">
                      {qualityLabels[load.quality || "standard"] || load.quality}
                    </span>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {load.city} · {faNumber(load.count ?? load.quantity)} بسته · هر کیلو{" "}
                      {faNumber(load.price)} تومان
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === load.id}
                      onClick={() => void handleLoadAction(load.id, "approve")}
                    >
                      تأیید و انتشار
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === load.id}
                      onClick={() => void handleLoadAction(load.id, "reject")}
                    >
                      رد بار
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: ALL LOADS + INLINE EDIT */}
        {tab === "allloads" && (
          <div className="mt-6 grid gap-4">
            {loads.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                هنوز باری ثبت نشده است.
              </p>
            ) : (
              loads.map((load) => (
                <article key={load.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <strong>
                        {load.product_type || load.name} {load.engine ? `· ${load.engine}` : ""}
                      </strong>
                      <p className="mt-1 text-xs text-muted-foreground">
                        عرضه: {load.city} · مبدأ: {load.origin || "—"} · فروشنده:{" "}
                        {load.member_name || "عضو ترابار"} ({load.member_phone || "—"})
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
                      {load.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    کیفیت: {qualityLabels[load.quality || "standard"] || load.quality} ·{" "}
                    {faNumber(load.count ?? 0)} بسته · هر کیلو {faNumber(load.price)} تومان
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingLoadId(load.id);
                        setLoadEditForm({
                          product_type: load.product_type || load.name || "",
                          engine: load.engine || "",
                          city: load.city || "",
                          origin: load.origin || "",
                          quality: load.quality || "standard",
                          price: String(load.price ?? 0),
                          count: String(load.count ?? 0),
                          package_weight: String(load.package_weight ?? 10),
                          status: load.status || "active",
                        });
                      }}
                    >
                      <Edit3 className="ml-1 size-3.5" />
                      ویرایش بار
                    </Button>
                    {load.status !== "active" && (
                      <Button
                        size="sm"
                        disabled={busyId === load.id}
                        onClick={() => void handleLoadAction(load.id, "approve")}
                      >
                        فعال‌سازی
                      </Button>
                    )}
                    {load.status === "active" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === load.id}
                        onClick={() => void handleLoadAction(load.id, "inactive")}
                      >
                        غیرفعال‌سازی
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === load.id}
                      onClick={() => void handleLoadAction(load.id, "archive")}
                    >
                      بایگانی
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === load.id}
                      onClick={() => void handleLoadAction(load.id, "delete")}
                    >
                      <Trash2 className="ml-1 size-3.5" />
                      حذف
                    </Button>
                  </div>

                  {editingLoadId === load.id && (
                    <form
                      onSubmit={submitLoadEdit}
                      className="mt-4 grid gap-3 rounded-xl border border-primary/40 bg-muted/40 p-4"
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="field-label">
                          محصول
                          <input
                            required
                            className="field-input"
                            value={loadEditForm.product_type}
                            onChange={(e) =>
                              setLoadEditForm((f) => ({ ...f, product_type: e.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          رقم / نوع
                          <input
                            className="field-input"
                            value={loadEditForm.engine}
                            onChange={(e) => setLoadEditForm((f) => ({ ...f, engine: e.target.value }))}
                          />
                        </label>
                        <label className="field-label">
                          وضعیت
                          <select
                            className="field-input"
                            value={loadEditForm.status}
                            onChange={(e) => setLoadEditForm((f) => ({ ...f, status: e.target.value }))}
                          >
                            <option value="active">فعال (active)</option>
                            <option value="pending">در انتظار (pending)</option>
                            <option value="inactive">غیرفعال (inactive)</option>
                            <option value="rejected">ردشده (rejected)</option>
                          </select>
                        </label>
                        <label className="field-label">
                          شهر عرضه
                          <input
                            className="field-input"
                            value={loadEditForm.city}
                            onChange={(e) => setLoadEditForm((f) => ({ ...f, city: e.target.value }))}
                          />
                        </label>
                        <label className="field-label">
                          قیمت (تومان)
                          <input
                            required
                            type="number"
                            className="field-input"
                            value={loadEditForm.price}
                            onChange={(e) => setLoadEditForm((f) => ({ ...f, price: e.target.value }))}
                          />
                        </label>
                        <label className="field-label">
                          موجودی (بسته)
                          <input
                            required
                            type="number"
                            className="field-input"
                            value={loadEditForm.count}
                            onChange={(e) => setLoadEditForm((f) => ({ ...f, count: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busyId === load.id}>
                          ذخیره تغییرات بار
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingLoadId(null)}
                        >
                          انصراف
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {/* TAB: MEMBERS + EDIT / ARCHIVE / RESTORE */}
        {tab === "members" && (
          <div className="mt-6 grid gap-3">
            {members.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                عضوی ثبت نشده است.
              </p>
            ) : (
              members.map((member) => (
                <article key={member.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <strong>{member.full_name}</strong>
                      <p className="mt-1 text-xs text-muted-foreground">
                        شهر: {member.city || "—"} · استان: {member.province || "—"} · نقش:{" "}
                        {roleLabels[member.role] || member.role}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                        {member.phone || "—"} {member.email ? `· ${member.email}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs">
                      {member.verification_status === "approved"
                        ? "تأییدشده"
                        : member.verification_status === "rejected"
                          ? "ردشده"
                          : "در انتظار بررسی"}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingMemberId(member.id);
                        setMemberEditForm({
                          fullName: member.full_name || "",
                          phone: member.phone || "",
                          email: member.email || "",
                          city: member.city || "",
                          province: member.province || "",
                          role: member.role || "buyer",
                          verificationStatus: member.verification_status || "approved",
                        });
                      }}
                    >
                      <Edit3 className="ml-1 size-3.5" />
                      ویرایش اطلاعات
                    </Button>
                    {member.is_archived ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === member.id}
                        onClick={() => void handleMemberAction(member.id, "restore")}
                      >
                        بازگردانی عضو
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === member.id}
                        onClick={() => void handleMemberAction(member.id, "archive")}
                      >
                        بایگانی عضو
                      </Button>
                    )}
                  </div>

                  {editingMemberId === member.id && (
                    <form
                      onSubmit={submitMemberEdit}
                      className="mt-4 grid gap-3 rounded-xl border border-primary/40 bg-muted/40 p-4"
                    >
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="field-label">
                          نام و نام خانوادگی
                          <input
                            required
                            className="field-input"
                            value={memberEditForm.fullName}
                            onChange={(e) =>
                              setMemberEditForm((f) => ({ ...f, fullName: e.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          موبایل
                          <input
                            dir="ltr"
                            className="field-input text-left"
                            value={memberEditForm.phone}
                            onChange={(e) =>
                              setMemberEditForm((f) => ({ ...f, phone: e.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          ایمیل
                          <input
                            dir="ltr"
                            className="field-input text-left"
                            value={memberEditForm.email}
                            onChange={(e) =>
                              setMemberEditForm((f) => ({ ...f, email: e.target.value }))
                            }
                          />
                        </label>
                        <label className="field-label">
                          استان
                          <select
                            className="field-input"
                            value={memberEditForm.province}
                            onChange={(e) =>
                              setMemberEditForm((f) => ({ ...f, province: e.target.value }))
                            }
                          >
                            <option value="">انتخاب استان</option>
                            {provinces.map((p) => (
                              <option key={p} value={p}>
                                {p}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="field-label">
                          شهر
                          <CityPicker
                            id={`edit-member-city-${member.id}`}
                            value={memberEditForm.city}
                            onChange={(val) => setMemberEditForm((f) => ({ ...f, city: val }))}
                          />
                        </label>
                        <label className="field-label">
                          نقش و وضعیت
                          <div className="grid grid-cols-2 gap-2">
                            <select
                              className="field-input"
                              value={memberEditForm.role}
                              onChange={(e) =>
                                setMemberEditForm((f) => ({ ...f, role: e.target.value }))
                              }
                            >
                              <option value="buyer">خریدار عادی</option>
                              <option value="special_buyer">خریدار ویژه</option>
                              <option value="seller">بارفروش</option>
                              <option value="supplier">تأمین‌کننده</option>
                            </select>
                            <select
                              className="field-input"
                              value={memberEditForm.verificationStatus}
                              onChange={(e) =>
                                setMemberEditForm((f) => ({
                                  ...f,
                                  verificationStatus: e.target.value,
                                }))
                              }
                            >
                              <option value="approved">تأییدشده</option>
                              <option value="pending">در انتظار</option>
                              <option value="rejected">ردشده</option>
                            </select>
                          </div>
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={busyId === member.id}>
                          ذخیره اطلاعات عضو
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setEditingMemberId(null)}
                        >
                          انصراف
                        </Button>
                      </div>
                    </form>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {/* TAB: ORDERS */}
        {tab === "orders" && (
          <div className="mt-6 grid gap-4">
            {orders.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                هنوز سفارشی ثبت نشده است.
              </p>
            ) : (
              orders.map((order) => (
                <div key={order.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>فاکتور شماره {faNumber(order.invoice_number)}</strong>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                      {orderStatusLabels[order.status] ?? order.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">
                    خریدار: {order.customer_name} ({order.customer_phone || "—"}) · شهر: {order.customer_city}
                  </p>
                  <p className="mt-1 text-sm">
                    تعداد: {faNumber(order.quantity)} {order.unit} · مبلغ کل:{" "}
                    <strong>{faNumber(order.total_price)} تومان</strong>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    پرداخت: {paymentStatusLabels[order.payment_status] ?? order.payment_status} · تحویل:{" "}
                    {deliveryStatusLabels[order.delivery_status] ?? order.delivery_status} ·{" "}
                    {new Date(order.created_at).toLocaleString("fa-IR")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.status === "pending" && (
                      <>
                        <Button
                          size="sm"
                          disabled={busyId === order.id}
                          onClick={() => void handleOrderAction(order.id, "accept")}
                        >
                          تأیید سفارش
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === order.id}
                          onClick={() => void handleOrderAction(order.id, "reject")}
                        >
                          رد سفارش
                        </Button>
                      </>
                    )}
                    {order.status !== "rejected" && order.payment_status !== "paid" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === order.id}
                        onClick={() => void handleOrderAction(order.id, "mark_paid")}
                      >
                        تأیید پرداخت (محاسبه ۵٪ کمیسیون)
                      </Button>
                    )}
                    {order.status === "accepted" && order.delivery_status === "awaiting_dispatch" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === order.id}
                        onClick={() => void handleOrderAction(order.id, "ship")}
                      >
                        ثبت ارسال
                      </Button>
                    )}
                    {order.status === "accepted" && order.delivery_status === "shipped" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === order.id}
                        onClick={() => void handleOrderAction(order.id, "deliver")}
                      >
                        ثبت تحویل
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: PURCHASE REQUESTS (open | matched | closed | cancelled) */}
        {tab === "purchases" && (
          <div className="mt-6 grid gap-4">
            {purchaseRequests.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                درخواست خریدی برای نمایش وجود ندارد.
              </p>
            ) : (
              purchaseRequests.map((req) => (
                <div key={req.id} className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>
                      درخواست شماره {faNumber(req.request_number)} · {req.product_type} ·{" "}
                      {faNumber(req.quantity)} {req.quantity_unit}
                    </strong>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs">
                      {purchaseStatusLabels[req.status] ?? req.status}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    متقاضی: {req.buyer_name || "خریدار"} ({req.buyer_phone || "—"}) · شهر مقصد:{" "}
                    {req.destination_city || "ثبت‌نشده"} · کیفیت: {req.quality_requirements || "توافقی"}
                    {req.needed_by ? ` · زمان نیاز: ${req.needed_by}` : ""}
                  </p>
                  {req.notes && <p className="mt-2 text-sm text-muted-foreground">{req.notes}</p>}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {req.status !== "matched" && (
                      <Button
                        size="sm"
                        disabled={busyId === req.id}
                        onClick={() => void updatePurchaseStatus(req, "matched")}
                      >
                        تأمین / تطبیق یافت
                      </Button>
                    )}
                    {req.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === req.id}
                        onClick={() => void updatePurchaseStatus(req, "closed")}
                      >
                        بستن (تکمیل‌شده)
                      </Button>
                    )}
                    {req.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === req.id}
                        onClick={() => void updatePurchaseStatus(req, "cancelled")}
                      >
                        لغو درخواست
                      </Button>
                    )}
                    {req.status !== "open" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === req.id}
                        onClick={() => void updatePurchaseStatus(req, "open")}
                      >
                        بازگشایی مجدد
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB: FINANCE & SETTLEMENTS (D1 aligned) */}
        {tab === "finance" && isAdmin && (
          <div className="mt-6 grid gap-6">
            <div>
              <h2 className="text-lg font-bold">امور مالی، کمیسیون ۵٪ و تسویه فروشندگان</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                حساب شبا و تسویه فروشندگان را بررسی کنید. پس از انتقال وجه بانکی، وضعیت درخواست تسویه را روی «تسویه‌شده» قرار دهید تا پیامک برای فروشنده ارسال شود.
              </p>
            </div>

            {(() => {
              const settledLedger = platformLedger.filter((e) => e.entry_status === "settled");
              const commissionSum = settledLedger
                .filter((e) => e.entry_type === "commission")
                .reduce((s, e) => s + Number(e.amount || 0), 0);
              const payoutSum = settledLedger
                .filter((e) => e.entry_type === "payout")
                .reduce((s, e) => s + Number(e.amount || 0), 0);
              return (
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">فروش کل تسویه‌شده (قطعی)</p>
                    <p className="mt-2 text-lg font-extrabold">
                      {faNumber(perfStats?.settledSalesAmount ?? 0)} تومان
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">درآمد کارمزد ۵٪ پلتفرم</p>
                    <p className="mt-2 text-lg font-extrabold text-primary">
                      {faNumber(commissionSum || perfStats?.totalCommissionAmount || 0)} تومان
                    </p>
                  </div>
                  <div className="rounded-xl border border-border bg-card p-4">
                    <p className="text-xs text-muted-foreground">کل تسویه‌های پرداخت‌شده به فروشندگان</p>
                    <p className="mt-2 text-lg font-extrabold text-emerald-600">
                      {faNumber(payoutSum)} تومان
                    </p>
                  </div>
                </div>
              );
            })()}

            {/* Seller Bank Accounts */}
            <div className="grid gap-3">
              <h3 className="text-base font-bold">شماره شبا و وضعیت مانده حساب فروشندگان</h3>
              {bankAccounts.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  هنوز شماره شبایی توسط فروشندگان ثبت نشده است.
                </p>
              ) : (
                bankAccounts.map((acc) => {
                  const txs = financeTransactions.filter((t) => t.member_id === acc.member_id);
                  const netCredits = txs
                    .filter((t) => t.transaction_type === "sale_credit")
                    .reduce((s, t) => s + Number(t.amount || 0), 0);
                  const settledPayouts = txs
                    .filter((t) => t.transaction_type === "payout" && t.payout_status === "settled")
                    .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
                  const pendingPayouts = txs
                    .filter((t) => t.transaction_type === "payout" && t.payout_status === "pending")
                    .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
                  const available = Math.max(0, netCredits - settledPayouts - pendingPayouts);

                  return (
                    <article key={acc.id} className="rounded-xl border border-border bg-card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <strong>{acc.member_name || acc.account_holder_name}</strong>
                          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                            {acc.member_phone || "—"}
                          </p>
                        </div>
                        <span className="rounded-full bg-secondary px-3 py-1 text-xs">
                          {acc.verification_status === "verified"
                            ? "شبا تأییدشده"
                            : acc.verification_status === "rejected"
                              ? "شبا ردشده"
                              : "در انتظار بررسی"}
                        </span>
                      </div>

                      <div className="mt-3 grid gap-1.5 rounded-lg bg-muted/50 p-3 text-xs">
                        <p className="flex items-center gap-2 font-semibold">
                          <Landmark className="size-4" />
                          {acc.bank_name} · صاحب حساب: {acc.account_holder_name}
                        </p>
                        <p dir="ltr" className="font-mono text-right text-sm">
                          {acc.iban}
                        </p>
                        <p>
                          اعتبار خالص ۹۵٪ فروش: {faNumber(netCredits)} تومان · پرداخت‌شده:{" "}
                          {faNumber(settledPayouts)} تومان · در صف پرداخت: {faNumber(pendingPayouts)} تومان ·{" "}
                          <strong>مانده قابل تسویه: {faNumber(available)} تومان</strong>
                        </p>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {acc.verification_status !== "verified" && (
                          <Button
                            size="sm"
                            disabled={financeBusy}
                            onClick={() => void verifyBankAccount(acc, "verified")}
                          >
                            <CheckCircle2 className="ml-1 size-4" />
                            تأیید شماره شبا
                          </Button>
                        )}
                        {acc.verification_status !== "rejected" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={financeBusy}
                            onClick={() => void verifyBankAccount(acc, "rejected")}
                          >
                            <XCircle className="ml-1 size-4" />
                            رد شماره شبا
                          </Button>
                        )}
                      </div>

                      {acc.verification_status === "verified" && (
                        <div className="mt-4 grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_auto]">
                          <label className="field-label">
                            مبلغ تسویه (تومان)
                            <input
                              className="field-input mt-1"
                              inputMode="numeric"
                              value={payoutAmounts[acc.member_id] ?? ""}
                              onChange={(e) =>
                                setPayoutAmounts((prev) => ({
                                  ...prev,
                                  [acc.member_id]: e.target.value,
                                }))
                              }
                              placeholder="مثلاً 5000000"
                            />
                          </label>
                          <label className="field-label">
                            شناسه پیگیری بانکی
                            <input
                              className="field-input mt-1"
                              value={payoutReferences[acc.member_id] ?? ""}
                              onChange={(e) =>
                                setPayoutReferences((prev) => ({
                                  ...prev,
                                  [acc.member_id]: e.target.value,
                                }))
                              }
                              placeholder="کد ارجاع یا شبا"
                            />
                          </label>
                          <div className="self-end">
                            <Button
                              disabled={financeBusy || available <= 0}
                              onClick={() => void createSellerPayout(acc.member_id)}
                            >
                              ثبت سند تسویه
                            </Button>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
            </div>

            {/* Payouts queue */}
            <div className="grid gap-3">
              <h3 className="text-base font-bold">صف درخواست‌های تسویه و سوابق پرداخت</h3>
              {financeTransactions.filter((t) => t.transaction_type === "payout").length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  درخواست تسویه‌ای ثبت نشده است.
                </p>
              ) : (
                financeTransactions
                  .filter((t) => t.transaction_type === "payout")
                  .map((tx) => (
                    <article key={tx.id} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <strong>
                            {tx.member_name || "فروشنده"} · {faNumber(Math.abs(tx.amount))} تومان
                          </strong>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {tx.description} ·{" "}
                            {tx.reference_code ? `کد مرجع: ${tx.reference_code}` : "بدون کد پیگیری"}
                          </p>
                          <p className="mt-1 text-xs font-semibold">
                            وضعیت:{" "}
                            {tx.payout_status === "settled"
                              ? "تسویه‌شده (پرداخت موفق)"
                              : tx.payout_status === "failed"
                                ? "ناموفق"
                                : tx.payout_status === "cancelled"
                                  ? "لغوشده"
                                  : "در انتظار پرداخت"}
                          </p>
                          {tx.payout_status === "pending" && (
                            <label className="mt-2 block max-w-xs text-xs">
                              شماره پیگیری حواله بانکی
                              <input
                                className="field-input mt-1"
                                value={payoutReferences[tx.id] ?? tx.reference_code ?? ""}
                                onChange={(e) =>
                                  setPayoutReferences((prev) => ({
                                    ...prev,
                                    [tx.id]: e.target.value,
                                  }))
                                }
                                placeholder="شناسه پیگیری شبا / ساتنا / پایا"
                              />
                            </label>
                          )}
                        </div>
                        {tx.payout_status === "pending" && (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              disabled={financeBusy}
                              onClick={() => void updateSellerPayout(tx, "settled")}
                            >
                              تأیید پرداخت موفق
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={financeBusy}
                              onClick={() => void updateSellerPayout(tx, "failed")}
                            >
                              ناموفق
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={financeBusy}
                              onClick={() => void updateSellerPayout(tx, "cancelled")}
                            >
                              لغو
                            </Button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))
              )}
            </div>

            {/* Full ledger */}
            <div className="grid gap-2 rounded-xl border border-border bg-card p-5">
              <h3 className="text-base font-bold">گردش حساب تفصیلی و دفتر کل</h3>
              {financeTransactions.length === 0 ? (
                <p className="text-sm text-muted-foreground">هنوز تراکنشی ثبت نشده است.</p>
              ) : (
                financeTransactions.slice(0, 50).map((tx) => {
                  const typeLabel =
                    tx.transaction_type === "sale_credit"
                      ? "اعتبار فروش (۹۵٪ خالص)"
                      : tx.transaction_type === "commission"
                        ? "کارمزد ۵٪ ترابار"
                        : "واریز / تسویه فروشنده";
                  const isDebit = ["commission", "payout"].includes(tx.transaction_type);
                  return (
                    <div
                      key={tx.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2.5 text-xs"
                    >
                      <div>
                        <strong>
                          {tx.member_name || "عضو"} · {typeLabel}
                        </strong>
                        <p className="text-muted-foreground">
                          {tx.description} · {new Date(tx.transaction_date).toLocaleString("fa-IR")}
                        </p>
                      </div>
                      <strong className={isDebit ? "text-destructive" : "text-emerald-600"}>
                        {isDebit ? "−" : "+"}
                        {faNumber(Math.abs(tx.amount))} تومان
                      </strong>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* TAB: CITY MANAGERS & NEIGHBOR CITIES */}
        {tab === "managers" && isAdmin && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {/* Assign city manager */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold">تخصیص مدیر شهر</h2>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                کاربری را از میان اعضا انتخاب کنید تا به عنوان مدیر شهر برای یک یا چند شهر فعال شود.
              </p>
              <form className="mt-4 grid gap-4" onSubmit={saveCityManager}>
                <label className="field-label">
                  انتخاب عضو
                  <select
                    required
                    className="field-input"
                    value={selectedManagerMemberId}
                    onChange={(e) => {
                      const m = members.find((item) => item.id === e.target.value);
                      setSelectedManagerMemberId(e.target.value);
                      if (m?.city) setSelectedManagerCity(m.city);
                    }}
                  >
                    <option value="">انتخاب عضو…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} — {m.city || "نامشخص"} ({m.phone || "—"})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field-label">
                  شهر اصلی تحت مدیریت
                  <CityPicker
                    id="manager-primary-city"
                    value={selectedManagerCity}
                    onChange={setSelectedManagerCity}
                    placeholder="انتخاب شهر اصلی…"
                  />
                </label>

                <label className="field-label">
                  سایر شهرهای تحت پوشش (اختیاری، با ویرگول جدا کنید)
                  <input
                    className="field-input"
                    value={managerExtraCities}
                    onChange={(e) => setManagerExtraCities(e.target.value)}
                    placeholder="مثلاً شهریار، فردیس، قزوین"
                  />
                </label>

                <label className="field-label">
                  رمز عبور ورود پنل مدیر شهر (اختیاری؛ حداقل ۸ کاراکتر)
                  <input
                    type="password"
                    dir="ltr"
                    minLength={8}
                    className="field-input text-left"
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </label>

                <Button type="submit" disabled={managerBusy}>
                  {managerBusy ? "در حال ثبت…" : "ثبت / به‌روزرسانی مدیر شهر"}
                </Button>
              </form>

              <div className="mt-6 grid gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-bold">فهرست مدیران شهری</h3>
                {adminUsers.filter((a) => a.admin_role === "city_manager").length === 0 ? (
                  <p className="text-xs text-muted-foreground">هنوز مدیر شهری تعریف نشده است.</p>
                ) : (
                  adminUsers
                    .filter((a) => a.admin_role === "city_manager")
                    .map((manager) => {
                      const citiesAssigned = adminUserCities
                        .filter((c) => c.admin_user_id === manager.id)
                        .map((c) => c.city_name);
                      return (
                        <div
                          key={manager.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-xs"
                        >
                          <div>
                            <strong className="text-sm">{manager.display_name}</strong>
                            <p className="text-muted-foreground">
                              نام کاربری: <span dir="ltr">{manager.login_username}</span> · شهرها:{" "}
                              {citiesAssigned.length ? citiesAssigned.join("، ") : manager.city}
                            </p>
                          </div>
                          {manager.is_active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={managerBusy}
                              onClick={() => void deactivateCityManager(manager)}
                            >
                              غیرفعال‌سازی
                            </Button>
                          ) : (
                            <span className="rounded bg-muted px-2 py-0.5 text-muted-foreground">غیرفعال</span>
                          )}
                        </div>
                      );
                    })
                )}
              </div>
            </div>

            {/* Neighbor cities management */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold">مدیریت شهرهای همجوار (دسترسی بازار منطقه‌ای)</h2>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                اعضای حرفه‌ای هر شهر می‌توانند بارهای شهر خود و شهرهای همجوار فعال را مشاهده و سفارش دهند.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="field-label">
                  شهر مبدأ
                  <select
                    className="field-input"
                    value={neighborCityA}
                    onChange={(e) => setNeighborCityA(e.target.value)}
                  >
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  شهر همجوار
                  <select
                    className="field-input"
                    value={neighborCityB}
                    onChange={(e) => setNeighborCityB(e.target.value)}
                  >
                    {cities.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                onClick={() => void handleToggleCityNeighbor(neighborCityA, neighborCityB, true)}
              >
                افزودن / فعال‌سازی ارتباط همجواری
              </Button>

              <div className="mt-5 grid max-h-96 gap-2 overflow-y-auto border-t border-border pt-4">
                {cityNeighbors.map((cn) => (
                  <div
                    key={cn.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                  >
                    <span>
                      <strong>{cn.city_name}</strong> ↔ <strong>{cn.neighbor_city_name}</strong>
                    </span>
                    <Button
                      size="sm"
                      variant={cn.is_enabled ? "outline" : "default"}
                      onClick={() =>
                        void handleToggleCityNeighbor(
                          cn.city_name,
                          cn.neighbor_city_name,
                          !cn.is_enabled,
                        )
                      }
                    >
                      {cn.is_enabled ? "فعال (کلیک برای غیرفعال)" : "غیرفعال (فعال‌سازی)"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB: SMS / EMAIL & AUDIT LOGS */}
        {tab === "smslogs" && isAdmin && (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold">گزارش پیامک‌ها و ایمیل‌های ارسالی (sms.ir / Resend)</h2>
              <div className="mt-4 grid max-h-[32rem] gap-2 overflow-y-auto">
                {smsLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">هنوز گزارشی ثبت نشده است.</p>
                ) : (
                  smsLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold" dir="ltr">
                          {log.recipient}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-semibold ${
                            log.status === "sent"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-destructive/15 text-destructive"
                          }`}
                        >
                          {log.channel.toUpperCase()} · {log.status === "sent" ? "ارسال موفق" : "ناموفق"}
                        </span>
                      </div>
                      <p className="mt-1 text-foreground">{log.message_summary}</p>
                      <p className="mt-1 text-muted-foreground">
                        رویداد: {log.event_type} · {new Date(log.created_at).toLocaleString("fa-IR")}
                      </p>
                      {log.error_message && (
                        <p className="mt-1 text-destructive">خطا: {log.error_message}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-bold">گزارش ثبت وقایع و تغییرات سیستمی (Audit Logs)</h2>
              <div className="mt-4 grid max-h-[32rem] gap-2 overflow-y-auto">
                {auditLogs.length === 0 ? (
                  <p className="text-sm text-muted-foreground">رویدادی ثبت نشده است.</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="rounded-lg border border-border p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="font-mono">{log.action}</strong>
                        <span className="text-muted-foreground">
                          {new Date(log.created_at).toLocaleString("fa-IR")}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        نقش: {log.actor_role} · هدف: {log.target_type || "—"} ({log.target_id || "—"})
                      </p>
                      {log.details && <p className="mt-1 text-foreground">{log.details}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB: REVIEWS */}
        {tab === "reviews" && isAdmin && (
          <div className="mt-6 grid gap-4">
            {ratings.length === 0 ? (
              <p className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
                هنوز نظر یا امتیازی ثبت نشده است.
              </p>
            ) : (
              ratings.map((rating) => {
                const msgs = ratingMessages[rating.id];
                return (
                  <div key={rating.id} className="rounded-xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>نظر سفارش {rating.order_id?.slice(0, 8) || "—"}</strong>
                      <span className="text-amber-600">
                        {"★".repeat(Math.max(0, Math.min(5, rating.score)))}
                        {"☆".repeat(5 - Math.max(0, Math.min(5, rating.score)))} · {rating.score}/۵
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      عضو: {rating.reviewer_member_id} ·{" "}
                      {new Date(rating.created_at).toLocaleString("fa-IR")}
                    </p>
                    <p className="mt-3 rounded-lg bg-muted p-3 text-sm">
                      {rating.review_text || "بدون توضیح متنی."}
                    </p>

                    <div className="mt-3">
                      {!msgs ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void loadMessagesForRating(rating.id)}
                        >
                          مشاهده گفت‌وگو و پاسخ‌ها
                        </Button>
                      ) : (
                        <div className="grid gap-2">
                          {msgs.map((m) => (
                            <div key={m.id} className="rounded-lg border border-border p-2.5 text-xs">
                              <span className="text-muted-foreground">
                                {m.sender_user_id === user.id ? "پاسخ مدیریت" : "پیام کاربر"} ·{" "}
                                {new Date(m.created_at).toLocaleString("fa-IR")}
                              </span>
                              <p className="mt-1 text-sm">{m.message}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <form
                      className="mt-4 flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void sendRatingReply(rating.id);
                      }}
                    >
                      <input
                        className="field-input flex-1"
                        value={ratingReplies[rating.id] ?? ""}
                        onChange={(e) =>
                          setRatingReplies((prev) => ({ ...prev, [rating.id]: e.target.value }))
                        }
                        placeholder="پاسخ یا پیام پیگیری به خریدار…"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        disabled={busyId === rating.id || !(ratingReplies[rating.id] ?? "").trim()}
                      >
                        ارسال
                      </Button>
                    </form>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* TAB: VISITS */}
        {tab === "visits" && isAdmin && (
          <div className="mt-6 grid gap-4">
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">کل بازدیدهای ثبت‌شده</p>
              <p className="mt-2 text-2xl font-extrabold">{faNumber(recentVisits.length)}</p>
            </div>
            <div className="grid gap-3">
              {recentVisits.length === 0 ? (
                <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
                  بازدیدی ثبت نشده است.
                </p>
              ) : (
                recentVisits.map((v) => (
                  <div key={v.id} className="rounded-xl border border-border bg-card p-4 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">{v.full_name || "بازدیدکننده مهمان"}</strong>
                      <span className="text-muted-foreground">
                        {new Date(v.visited_at || v.created_at || Date.now()).toLocaleString("fa-IR")}
                      </span>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      مسیر: <span dir="ltr">{v.route}</span> · شهر: {v.city || "—"} · تلفن:{" "}
                      <span dir="ltr">{v.phone || "—"}</span>
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB: SECURITY */}
        {tab === "security" && isAdmin && (
          <div className="mt-6 max-w-xl">
            <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-xl bg-accent text-primary">
                  <KeyRound className="size-6" />
                </span>
                <div>
                  <h2 className="text-xl font-bold">امنیت و تغییر رمز عبور مدیر کل</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    تغییر رمز فقط پس از تأیید کد پیامکی ۶ رقمی به شماره ثبت‌شده مدیر کل انجام می‌شود.
                  </p>
                </div>
              </div>

              {securityError && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {securityError}
                </p>
              )}
              {securityNotice && (
                <p role="status" className="mt-4 text-sm font-semibold text-emerald-600">
                  {securityNotice}
                </p>
              )}

              {!securityOtpSent ? (
                <div className="mt-6">
                  <Button type="button" onClick={handleSendAdminOtp} disabled={securityBusy}>
                    <Phone className="ml-2 size-4" />
                    {securityBusy ? "در حال ارسال پیامک…" : "ارسال کد تأیید پیامک برای تغییر رمز"}
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleChangeAdminPassword} className="mt-6 grid gap-4">
                  <label className="field-label">
                    کد تأیید ۶ رقمی
                    <input
                      required
                      dir="ltr"
                      inputMode="numeric"
                      maxLength={6}
                      value={securityOtpCode}
                      onChange={(e) => setSecurityOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="field-input text-center text-lg tracking-[0.3em]"
                      placeholder="000000"
                    />
                  </label>
                  <label className="field-label">
                    رمز عبور جدید مدیر (حداقل ۸ کاراکتر)
                    <input
                      required
                      type="password"
                      dir="ltr"
                      minLength={8}
                      value={securityNewPassword}
                      onChange={(e) => setSecurityNewPassword(e.target.value)}
                      className="field-input text-left"
                    />
                  </label>
                  <label className="field-label">
                    تکرار رمز عبور جدید
                    <input
                      required
                      type="password"
                      dir="ltr"
                      minLength={8}
                      value={securityConfirmPassword}
                      onChange={(e) => setSecurityConfirmPassword(e.target.value)}
                      className="field-input text-left"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={securityBusy || securityOtpCode.length !== 6}>
                      <Lock className="ml-2 size-4" />
                      {securityBusy ? "در حال ثبت…" : "ذخیره رمز عبور جدید"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={securityBusy}
                      onClick={handleSendAdminOtp}
                    >
                      ارسال مجدد کد
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}

        {/* TAB: BACKUP */}
        {tab === "backup" && isAdmin && (
          <div className="mt-6 max-w-4xl space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Database className="size-6" />
                  </span>
                  <div>
                    <h2 className="text-xl font-extrabold">پشتیبان‌گیری دائمی و خروجی پایگاه داده</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      دریافت نسخه کامل پایگاه داده SQLite / D1 همراه با تمام جداول و سوابق
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchDbStats()}
                  disabled={loadingDbStats}
                  className="gap-2"
                >
                  <RefreshCw className={`size-4 text-primary ${loadingDbStats ? "animate-spin" : ""}`} />
                  بروزرسانی آمار
                </Button>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                  <span className="text-xs text-muted-foreground">کل کاربران</span>
                  <p className="mt-2 text-2xl font-black">
                    {faNumber(dbStats?.usersCount ?? members.length)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                  <span className="text-xs text-muted-foreground">کل بارها</span>
                  <p className="mt-2 text-2xl font-black">
                    {faNumber(dbStats?.loadsCount ?? loads.length)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                  <span className="text-xs text-muted-foreground">کل سفارش‌ها</span>
                  <p className="mt-2 text-2xl font-black">
                    {faNumber(dbStats?.ordersCount ?? orders.length)}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
                  <span className="text-xs text-muted-foreground">حجم پایگاه داده</span>
                  <p className="mt-2 font-mono text-2xl font-black" dir="ltr">
                    {dbStats?.databaseSizeFormatted || "—"}
                  </p>
                </div>
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col justify-between rounded-xl border-2 border-primary/40 bg-card p-5">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-primary">
                      <HardDrive className="size-5" />
                      <span>فایل باینری SQLite</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      دانلود مستقیم فایل پایگاه داده (.sqlite) برای آرشیو دائمی و بازیابی سریع.
                    </p>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <a
                      href="/api/admin/backup-db"
                      download
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground transition hover:bg-primary/90"
                    >
                      <Download className="size-4" />
                      دانلود فایل .sqlite
                    </a>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-emerald-700 dark:text-emerald-400">
                      <FileArchive className="size-5" />
                      <span>اسکریپت کامل SQL</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      خروجی استاندارد SQL شامل تمام رکوردها جهت ایمپورت در D1 یا SQLite.
                    </p>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <a
                      href="/api/admin/export-sql"
                      download
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-emerald-800"
                    >
                      <Download className="size-4" />
                      دانلود اسکریپت .sql
                    </a>
                  </div>
                </div>

                <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-5">
                  <div>
                    <div className="flex items-center gap-2 font-bold text-amber-700 dark:text-amber-400">
                      <Database className="size-5" />
                      <span>خروجی ساختاریافته JSON</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      خروجی JSON از همه جداول جهت گزارش‌گیری و پردازش اطلاعات.
                    </p>
                  </div>
                  <div className="mt-4 border-t border-border pt-3">
                    <a
                      href="/api/admin/export-json"
                      download
                      className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-amber-700"
                    >
                      <Download className="size-4" />
                      دانلود فایل .json
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
