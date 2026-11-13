import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Globe,
  ImagePlus,
  MapPin,
  Megaphone,
  ShieldAlert,
  Store,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api-client";
import { faNumber, normalizeNumericInput, pageHead, provinces, qualities } from "@/lib/marketplace";
import { CityPicker } from "@/components/city-picker";
import { convertToOptimizedWebP } from "@/lib/image-optimizer";

export const Route = createFileRoute("/announce")({
  head: () =>
    pageHead(
      "اعلام و مدیریت بار | ترابار",
      "ثبت، ویرایش، تصویرگذاری و مدیریت آنی بارهای معمولی و ویژه حرفه‌ای در ترابار.",
    ),
  component: AnnouncePage,
});

const qualityValues = ["premium", "standard", "economy", "negotiated"] as const;
const qualityMap = Object.fromEntries(qualities.map((label, index) => [label, qualityValues[index]]));
const reverseQualityMap: Record<string, string> = {
  premium: qualities[0] || "ممتاز (درجه ۱)",
  standard: qualities[1] || "استاندارد",
  economy: qualities[2] || "اقتصادی",
  negotiated: qualities[3] || "توافقی",
};

const salesSections = [
  { key: "retail", label: "خرده‌فروشی", defaultMin: 1 },
  { key: "wholesale", label: "عمده‌فروشی", defaultMin: 2 },
  { key: "special", label: "فروش ویژه", defaultMin: 2 },
  { key: "professional", label: "ویژه حرفه‌ای", defaultMin: 5 },
] as const;
type SaleSectionKey = (typeof salesSections)[number]["key"];
type AnnouncementMode = "regular" | "professional";

type LoadTier = {
  sale_type: string;
  unit_price: number;
  minimum_packages: number;
  min_quantity?: number;
};

type LoadImage = {
  storage_path: string;
  display_order: number;
};

type OwnedLoad = {
  id: string;
  name: string;
  product_type: string;
  engine: string | null;
  city: string;
  origin: string | null;
  source_region?: string | null;
  quality: string | null;
  quantity: number;
  count: number | null;
  price: number;
  sale_type?: string | null;
  status: string;
  package_type: string | null;
  package_weight: number | null;
  min_order_quantity: number | null;
  ready_date: string | null;
  ad_start_date?: string | null;
  ad_end_date?: string | null;
  response_start_time?: string | null;
  response_end_time?: string | null;
  destination_scope?: string | null;
  fleet_type?: string | null;
  description: string | null;
  created_at: string;
  tiers?: LoadTier[];
  images?: LoadImage[];
};

type IncomingOrder = {
  id: string;
  invoice_number?: number;
  load_id: string;
  customer_name: string;
  customer_phone?: string | null;
  customer_city: string;
  quantity: number;
  unit: string;
  price: number;
  total_price: number;
  delivery_address: string | null;
  delivery_type: string | null;
  status: string;
  payment_status: string;
  delivery_status: string;
  notes: string | null;
  created_at: string;
};

const loadStatusLabels: Record<string, string> = {
  pending: "در انتظار تأیید",
  active: "فعال",
  inactive: "غیرفعال",
  rejected: "رد شده",
  sold_out: "تمام‌شده",
  expired: "منقضی‌شده",
};
const orderStatusLabels: Record<string, string> = {
  pending: "در انتظار پاسخ شما",
  accepted: "تأیید شده توسط فروشنده",
  rejected: "رد شده توسط فروشنده",
};
const paymentStatusLabels: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  pending: "در انتظار تأیید پرداخت",
  paid: "پرداخت تأییدشده",
  failed: "پرداخت ناموفق",
  refunded: "بازپرداخت‌شده",
};
const deliveryStatusLabels: Record<string, string> = {
  awaiting_payment: "در انتظار پرداخت / آماده‌سازی",
  awaiting_dispatch: "آماده ارسال",
  shipped: "بار ارسال شده",
  delivered: "تحویل داده شده",
  disputed: "در حال بررسی اختلاف",
};

const localIsoDate = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const jalaliFormatter = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});
const jalaliDisplayFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const jalaliMonthFormatter = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { month: "long" });
const jalaliParts = (date: Date) =>
  Object.fromEntries(
    jalaliFormatter
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as { year: number; month: number; day: number };

function JalaliDateField({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? new Date(`${value}T12:00:00`) : new Date();
  const [view, setView] = useState(() => selected);
  useEffect(() => {
    if (value) setView(new Date(`${value}T12:00:00`));
  }, [value]);
  const parts = jalaliParts(view);
  const monthStart = (() => {
    for (let offset = -35; offset <= 5; offset++) {
      const candidate = new Date(view.getFullYear(), view.getMonth(), view.getDate() + offset, 12);
      const p = jalaliParts(candidate);
      if (p.year === parts.year && p.month === parts.month && p.day === 1) return candidate;
    }
    return new Date(view.getFullYear(), view.getMonth(), 1, 12);
  })();
  const monthDays = Array.from(
    { length: 31 },
    (_, i) => new Date(monthStart.getFullYear(), monthStart.getMonth(), monthStart.getDate() + i, 12),
  ).filter((d) => {
    const p = jalaliParts(d);
    return p.year === parts.year && p.month === parts.month;
  });
  const firstWeekday = (monthStart.getDay() + 1) % 7;
  const minIso = min ?? "";
  const toIso = (date: Date) => localIsoDate(date);
  const dayNames = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  return (
    <div className="field-label relative">
      {label}
      <button
        type="button"
        className="field-input w-full text-right"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {value ? jalaliDisplayFormatter.format(selected) : "انتخاب تاریخ شمسی"}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 w-[min(20rem,90vw)] rounded-xl border border-border bg-background p-3 shadow-lg"
          dir="rtl"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 15, 12))}
              aria-label="ماه قبل"
            >
              ماه قبل
            </button>
            <strong className="text-sm">
              {jalaliMonthFormatter.format(monthStart)} {parts.year.toLocaleString("fa-IR")}
            </strong>
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 15, 12))}
              aria-label="ماه بعد"
            >
              ماه بعد
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {dayNames.map((d, i) => (
              <span key={i} className="py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {monthDays.map((date) => {
              const iso = toIso(date);
              const day = jalaliParts(date).day;
              const disabled = Boolean(minIso && iso < minIso);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onChange(iso);
                    setOpen(false);
                  }}
                  className={`rounded-md py-2 text-sm ${
                    iso === value ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  } ${disabled ? "cursor-not-allowed opacity-30" : ""}`}
                >
                  {day.toLocaleString("fa-IR")}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

async function optimizeLoadPhoto(file: File): Promise<File> {
  const result = await convertToOptimizedWebP(file, {
    maxWidth: 1600,
    maxHeight: 1600,
    quality: 0.78,
  });
  return result.file;
}

function stripMetaLine(description: string | null | undefined): string {
  if (!description) return "";
  return description
    .split("\n")
    .filter((line) => !line.trim().startsWith("[اعلان بار"))
    .join("\n")
    .trim();
}

function AnnouncePage() {
  const { user, member, loading, canAnnounce } = useAuth();
  const mainFormRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  const userRegisteredCity = (member?.city || user?.city || user?.province || "کرج").trim();
  const storefrontMemberId = member?.id || "";

  const [announcementType, setAnnouncementType] = useState<AnnouncementMode>("regular");
  const [destinationScope, setDestinationScope] = useState<"all_country" | "specific_city">("all_country");
  const [destinationCity, setDestinationCity] = useState("");
  const [fleetType, setFleetType] = useState("انواع باربری و ناوگان متناسب");

  const makeInitialForm = useCallback(
    () => ({
      product: "",
      variety: "",
      quality: qualities[1] || "استاندارد",
      city: userRegisteredCity,
      province: userRegisteredCity,
      packageType: "کارتن",
      weight: "",
      stock: "",
      ready: localIsoDate(),
      adStart: localIsoDate(),
      adEnd: localIsoDate(),
      responseStart: "08:00",
      responseEnd: "18:00",
      description: "",
    }),
    [userRegisteredCity],
  );

  const [form, setForm] = useState(makeInitialForm);
  const [editingLoadId, setEditingLoadId] = useState<string | null>(null);
  const [existingImages, setExistingImages] = useState<LoadImage[]>([]);
  const [removedImageKeys, setRemovedImageKeys] = useState<string[]>([]);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const [saleSectionsEnabled, setSaleSectionsEnabled] = useState<SaleSectionKey[]>(["retail"]);
  const [salePrices, setSalePrices] = useState<Record<SaleSectionKey, string>>({
    retail: "",
    wholesale: "",
    special: "",
    professional: "",
  });
  const [saleMinimums, setSaleMinimums] = useState<Record<SaleSectionKey, string>>({
    retail: "1",
    wholesale: "2",
    special: "2",
    professional: "5",
  });

  const [storeLinkCopied, setStoreLinkCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMode, setSavedMode] = useState<"created" | "updated" | null>(null);

  const [ownedLoads, setOwnedLoads] = useState<OwnedLoad[]>([]);
  const [incomingOrders, setIncomingOrders] = useState<IncomingOrder[]>([]);
  const [loadingOwnedLoads, setLoadingOwnedLoads] = useState(true);
  const [loadingIncomingOrders, setLoadingIncomingOrders] = useState(true);
  const [busyActionId, setBusyActionId] = useState("");

  useEffect(() => {
    if (!editingLoadId && userRegisteredCity) {
      setForm((prev) => ({
        ...prev,
        city: prev.city || userRegisteredCity,
        province: prev.province || userRegisteredCity,
      }));
    }
  }, [userRegisteredCity, editingLoadId]);

  useEffect(() => {
    const urls = photoFiles.map((file) => URL.createObjectURL(file));
    setPhotoPreviews(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [photoFiles]);

  const setField = (key: keyof typeof form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const resetToCreateForm = useCallback(() => {
    setEditingLoadId(null);
    setAnnouncementType("regular");
    setDestinationScope("all_country");
    setDestinationCity("");
    setFleetType("انواع باربری و ناوگان متناسب");
    setForm(makeInitialForm());
    setExistingImages([]);
    setRemovedImageKeys([]);
    setPhotoFiles([]);
    setSaleSectionsEnabled(["retail"]);
    setSalePrices({ retail: "", wholesale: "", special: "", professional: "" });
    setSaleMinimums({ retail: "1", wholesale: "2", special: "2", professional: "5" });
    setError("");
  }, [makeInitialForm]);

  const fetchSellerData = useCallback(async () => {
    if (!user) {
      setLoadingOwnedLoads(false);
      setLoadingIncomingOrders(false);
      return;
    }

    const targetMemberId = member?.id || "";
    if (!targetMemberId) {
      setLoadingOwnedLoads(false);
      setLoadingIncomingOrders(false);
      return;
    }

    setLoadingOwnedLoads(true);
    setLoadingIncomingOrders(true);

    const [loadsRes, ordersRes] = await Promise.all([
      apiGet<{ success?: boolean; loads?: OwnedLoad[] }>(
        `/api/loads/list?mode=all&memberId=${encodeURIComponent(targetMemberId)}`,
      ),
      apiGet<{ success?: boolean; orders?: IncomingOrder[] }>(
        `/api/orders/list?sellerMemberId=${encodeURIComponent(targetMemberId)}`,
      ),
    ]);

    if (loadsRes.ok && Array.isArray(loadsRes.data?.loads)) {
      setOwnedLoads(loadsRes.data.loads);
    }
    if (ordersRes.ok && Array.isArray(ordersRes.data?.orders)) {
      setIncomingOrders(ordersRes.data.orders);
    }

    setLoadingOwnedLoads(false);
    setLoadingIncomingOrders(false);
  }, [user, member?.id]);

  useEffect(() => {
    void fetchSellerData();
  }, [fetchSellerData]);

  const handleModeSwitch = (mode: AnnouncementMode) => {
    setAnnouncementType(mode);
    setError("");
    if (mode === "regular") {
      setForm((prev) => ({ ...prev, city: userRegisteredCity }));
      setSaleSectionsEnabled((prev) => {
        const filtered = prev.filter((k) => k !== "professional");
        return filtered.length ? filtered : ["retail"];
      });
    } else {
      setSaleSectionsEnabled((prev) =>
        prev.includes("professional") ? prev : ["professional", ...prev.filter((k) => k === "wholesale")],
      );
    }
  };

  const toggleSaleSection = (key: SaleSectionKey, checked: boolean) => {
    setSaleSectionsEnabled((prev) =>
      checked ? [...new Set([...prev, key])] : prev.filter((item) => item !== key),
    );
  };

  async function startEditInMainForm(load: OwnedLoad) {
    setError("");
    setSavedMode(null);
    setBusyActionId(load.id);

    const detailRes = await apiGet<{ success?: boolean; load?: OwnedLoad }>(
      `/api/loads/detail?id=${encodeURIComponent(load.id)}`,
    );
    const full = (detailRes.ok && detailRes.data?.load ? detailRes.data.load : load) as OwnedLoad;
    setBusyActionId("");

    const tiers = Array.isArray(full.tiers) ? full.tiers : [];
    const isPro =
      full.sale_type === "professional" ||
      full.city === "سراسر کشور" ||
      tiers.some((t) => t.sale_type === "professional") ||
      Boolean(full.description?.includes("بار حرفه‌ای"));

    setAnnouncementType(isPro ? "professional" : "regular");

    if (isPro) {
      if (full.destination_scope === "all_country" || full.city === "سراسر کشور") {
        setDestinationScope("all_country");
        setDestinationCity("");
      } else {
        setDestinationScope("specific_city");
        setDestinationCity(full.city || "");
      }
      setFleetType(full.fleet_type || "انواع باربری و ناوگان متناسب");
    } else {
      setDestinationScope("all_country");
      setDestinationCity("");
    }

    const pkgWeight =
      full.package_weight && full.package_weight > 0
        ? full.package_weight
        : full.count && full.count > 0
          ? Number(full.quantity) / Number(full.count)
          : 10;

    setForm({
      product: full.product_type || full.name || "",
      variety: full.engine || "",
      quality: reverseQualityMap[full.quality || "standard"] || qualities[1] || "استاندارد",
      city: full.city || userRegisteredCity,
      province: full.origin || full.source_region || userRegisteredCity,
      packageType: full.package_type || "کارتن",
      weight: String(pkgWeight || ""),
      stock: String(full.count ?? ""),
      ready: full.ready_date || localIsoDate(),
      adStart: full.ad_start_date || localIsoDate(),
      adEnd: full.ad_end_date || full.ad_start_date || localIsoDate(),
      responseStart: full.response_start_time || "08:00",
      responseEnd: full.response_end_time || "18:00",
      description: stripMetaLine(full.description),
    });

    const nextPrices: Record<SaleSectionKey, string> = {
      retail: "",
      wholesale: "",
      special: "",
      professional: "",
    };
    const nextMinimums: Record<SaleSectionKey, string> = {
      retail: "1",
      wholesale: "2",
      special: "2",
      professional: "5",
    };
    const enabledKeys: SaleSectionKey[] = [];

    for (const t of tiers) {
      const key = t.sale_type as SaleSectionKey;
      if (salesSections.some((s) => s.key === key)) {
        enabledKeys.push(key);
        nextPrices[key] = String(t.unit_price ?? full.price ?? "");
        nextMinimums[key] = String(t.minimum_packages ?? full.min_order_quantity ?? 1);
      }
    }

    if (!enabledKeys.length) {
      const fallbackKey: SaleSectionKey = isPro
        ? "professional"
        : salesSections.some((s) => s.key === (full.sale_type as SaleSectionKey))
          ? (full.sale_type as SaleSectionKey)
          : "retail";
      enabledKeys.push(fallbackKey);
      nextPrices[fallbackKey] = String(full.price ?? "");
      nextMinimums[fallbackKey] = String(full.min_order_quantity ?? 1);
    }

    setSaleSectionsEnabled(enabledKeys);
    setSalePrices(nextPrices);
    setSaleMinimums(nextMinimums);
    setExistingImages(
      Array.isArray(full.images)
        ? full.images.map((img, idx) => ({
            storage_path: img.storage_path,
            display_order: Number(img.display_order ?? idx),
          }))
        : [],
    );
    setRemovedImageKeys([]);
    setPhotoFiles([]);
    setEditingLoadId(full.id);

    window.setTimeout(() => {
      mainFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
    toast.info("اطلاعات بار در فرم اصلی بارگذاری شد؛ تغییرات دلخواه را اعمال و ذخیره کنید.");
  }

  async function toggleLoadStatus(load: OwnedLoad) {
    const nextStatus = load.status === "active" ? "inactive" : "active";
    setBusyActionId(load.id);
    const res = await apiPost("/api/loads/status", { id: load.id, status: nextStatus });
    setBusyActionId("");
    if (res.ok && res.data?.success) {
      setOwnedLoads((items) =>
        items.map((item) => (item.id === load.id ? { ...item, status: nextStatus } : item)),
      );
      toast.success(nextStatus === "active" ? "بار دوباره فعال و منتشر شد." : "بار غیرفعال شد.");
    } else {
      toast.error(res.data?.message || "تغییر وضعیت بار انجام نشد.");
    }
  }

  async function deleteLoad(load: OwnedLoad) {
    if (!window.confirm(`آیا از حذف بار «${load.name || load.product_type}» مطمئن هستید؟`)) return;
    setBusyActionId(load.id);
    const res = await apiPost("/api/loads/delete", { id: load.id, softArchive: false });
    setBusyActionId("");
    if (res.ok && res.data?.success) {
      setOwnedLoads((items) => items.filter((item) => item.id !== load.id));
      if (editingLoadId === load.id) resetToCreateForm();
      toast.success("بار مورد نظر حذف شد.");
    } else {
      toast.error(res.data?.message || "حذف بار انجام نشد.");
    }
  }

  async function handleOrderAction(
    orderId: string,
    action: "accept" | "reject" | "ship" | "deliver" | "mark_paid",
  ) {
    setBusyActionId(orderId);
    const res = await apiPost<{ success?: boolean; message?: string; order?: IncomingOrder }>(
      "/api/orders/update-status",
      { orderId, action },
    );
    setBusyActionId("");
    if (res.ok && res.data?.success) {
      toast.success(res.data.message || "وضعیت سفارش به‌روزرسانی شد.");
      if (res.data.order) {
        setIncomingOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, ...res.data.order } : o)),
        );
      } else {
        void fetchSellerData();
      }
      if (action === "accept") {
        void fetchSellerData();
      }
    } else {
      toast.error(res.data?.message || "ثبت عملیات روی سفارش انجام نشد.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!user || !canAnnounce) return;
    setBusy(true);
    setError("");

    const packageWeight = Number(form.weight);
    const packageCount = Number(form.stock);
    const isEditing = Boolean(editingLoadId);

    const validSaleSections = saleSectionsEnabled.filter((key) => {
      const p = Number(salePrices[key]);
      const min = Number(saleMinimums[key]);
      return (
        Number.isFinite(p) &&
        p >= 10000 &&
        Number.isInteger(min) &&
        min >= 1 &&
        min <= packageCount
      );
    });

    if (!saleSectionsEnabled.length || validSaleSections.length !== saleSectionsEnabled.length) {
      setError(
        "برای هر بخش فروش انتخاب‌شده، قیمت هر کیلو (حداقل ۱۰٬۰۰۰ تومان) و حداقل تعداد بسته (حداکثر برابر با موجودی) را معتبر وارد کنید.",
      );
      setBusy(false);
      return;
    }

    if (
      !form.product.trim() ||
      !form.variety.trim() ||
      !form.province.trim() ||
      !form.ready ||
      !form.adStart ||
      !form.adEnd ||
      (!isEditing && form.adStart < localIsoDate()) ||
      form.adEnd < form.adStart ||
      !form.responseStart ||
      !form.responseEnd ||
      form.responseEnd <= form.responseStart ||
      existingImages.length + photoFiles.length > 5 ||
      photoFiles.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 10 * 1024 * 1024,
      ) ||
      !Number.isFinite(packageWeight) ||
      packageWeight <= 0 ||
      !Number.isInteger(packageCount) ||
      packageCount < 1
    ) {
      setError("اطلاعات بار معتبر نیست. لطفاً تمام فیلدهای ضروری، تاریخ‌ها و بازه پاسخگویی را بررسی کنید.");
      setBusy(false);
      return;
    }

    if (announcementType === "professional" && destinationScope === "specific_city" && !destinationCity.trim()) {
      setError("برای ارسال به شهرستان مقصد مشخص، شهر یا شهرستان مقصد را انتخاب کنید.");
      setBusy(false);
      return;
    }

    let offeredCity = userRegisteredCity;
    let dispatchScopeText = `فروش درون‌شهری (منحصر به ${userRegisteredCity})`;
    if (announcementType === "professional") {
      if (destinationScope === "all_country") {
        offeredCity = "سراسر کشور";
        dispatchScopeText = "ارسال به تمامی شهرها و شهرستان‌های کشور";
      } else {
        offeredCity = destinationCity.trim();
        dispatchScopeText = `ارسال به شهرستان مقصد: ${offeredCity}`;
      }
    }

    // Upload new photos to ParsPack S3
    const uploadedImageKeys: string[] = [];
    for (const file of photoFiles) {
      let optimizedFile: File;
      try {
        optimizedFile = await optimizeLoadPhoto(file);
      } catch {
        optimizedFile = file;
      }
      const fd = new FormData();
      fd.append("file", optimizedFile);
      fd.append("folder", "loads");
      const uploadRes = await apiPost<{ success?: boolean; fileKey?: string; message?: string }>(
        "/api/storage/upload",
        fd,
      );
      if (uploadRes.ok && uploadRes.data?.fileKey) {
        uploadedImageKeys.push(uploadRes.data.fileKey);
      } else {
        toast.error(uploadRes.data?.message || "بارگذاری یکی از تصاویر انجام نشد.");
      }
    }

    // Delete any existing images removed during edit
    for (const key of removedImageKeys) {
      await apiPost("/api/storage/delete", { key }).catch(() => {});
    }

    const combinedImages: LoadImage[] = [
      ...existingImages.map((img, idx) => ({ storage_path: img.storage_path, display_order: idx })),
      ...uploadedImageKeys.map((fileKey, idx) => ({
        storage_path: fileKey,
        display_order: existingImages.length + idx,
      })),
    ];

    const originCity = form.province.trim();
    const firstSaleSection = validSaleSections[0];
    const canonicalPrice = Number(salePrices[firstSaleSection]);
    const canonicalMinimum = Number(saleMinimums[firstSaleSection]);
    const loadName = [form.product.trim(), form.variety.trim()].filter(Boolean).join(" ");

    const formattedDescription = [
      form.description.trim(),
      announcementType === "professional"
        ? `[اعلان بار حرفه‌ای | پوشش: ${dispatchScopeText} | ناوگان: ${fleetType}]`
        : `[اعلان بار معمولی | محدوده: ${dispatchScopeText}]`,
    ]
      .filter(Boolean)
      .join("\n");

    const tiers = validSaleSections.map((key) => ({
      sale_type: key,
      unit_price: Number(salePrices[key]),
      minimum_packages: Number(saleMinimums[key]),
      min_quantity: Number(saleMinimums[key]) * packageWeight,
      max_quantity: null,
    }));

    const syncPayload = {
      id: editingLoadId || undefined,
      name: loadName,
      product_type: form.product.trim(),
      engine: form.variety.trim() || null,
      quality: qualityMap[form.quality] ?? "standard",
      city: offeredCity,
      origin: originCity,
      source_region: originCity,
      quantity: packageWeight * packageCount,
      count: packageCount,
      package_type: form.packageType,
      package_weight: packageWeight,
      unit: "کیلوگرم",
      min_quantity: canonicalMinimum * packageWeight,
      min_order_quantity: canonicalMinimum,
      price: canonicalPrice,
      price_unit: "تومان",
      ready_date: form.ready,
      ad_start_date: form.adStart,
      ad_end_date: form.adEnd,
      response_start_time: form.responseStart,
      response_end_time: form.responseEnd,
      destination_scope: announcementType === "professional" ? destinationScope : "city",
      fleet_type: announcementType === "professional" ? fleetType : null,
      description: formattedDescription,
      status: "active",
      role: announcementType === "professional" ? "supplier" : "seller",
      seller_type: announcementType === "professional" ? "supplier" : "seller",
      sale_type: announcementType === "professional" ? "professional" : firstSaleSection || "retail",
      tiers,
      images: combinedImages,
    };

    const res = await apiPost<{ success?: boolean; load?: OwnedLoad; message?: string }>(
      "/api/loads/sync",
      syncPayload,
    );

    setBusy(false);
    if (!res.ok || !res.data?.success) {
      setError(res.data?.message || "ثبت اعلان بار در سرور انجام نشد.");
      return;
    }

    toast.success(isEditing ? "تغییرات بار با موفقیت ذخیره و منتشر شد." : "بار جدید با موفقیت ثبت و منتشر شد.");
    setSavedMode(isEditing ? "updated" : "created");
    if (isEditing) {
      setEditingLoadId(null);
      setRemovedImageKeys([]);
    }
    await fetchSellerData();
  }

  if (loading) {
    return <section className="py-16 text-center text-sm text-muted-foreground">در حال بارگذاری…</section>;
  }

  if (!user) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-md text-center">
          <h1 className="text-2xl font-extrabold">ابتدا وارد حساب شوید</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            برای ثبت و اعلام بار، لطفاً ابتدا با شماره همراه یا ایمیل خود وارد ترابار شوید.
          </p>
          <Button asChild className="mt-6">
            <Link to="/auth">ورود / ثبت‌نام</Link>
          </Button>
        </div>
      </section>
    );
  }

  if (!canAnnounce) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <ShieldAlert className="mx-auto mb-3 size-12 text-amber-600" />
          <h1 className="text-2xl font-extrabold">نیاز به تأیید عضویت بارفروش / تأمین‌کننده</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            ثبت و اعلام بار فقط برای حساب‌های دارای نقش تأییدشدهٔ <strong>بارفروش</strong> یا <strong>تأمین‌کننده</strong> فعال است. اگر درخواست خود را ثبت کرده‌اید، پس از تأیید مدیریت دسترسی شما به‌صورت خودکار باز می‌شود.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/membership">درخواست / تکمیل عضویت فروش</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/member-home">پنل عضویت و پیگیری وضعیت</Link>
            </Button>
          </div>
        </div>
      </section>
    );
  }

  const totalImagesCount = existingImages.length + photoFiles.length;

  return (
    <section className="bg-market-surface py-10">
      <div className="site-container max-w-3xl">
        {/* Storefront link card */}
        {storefrontMemberId && (
          <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                <Store className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-extrabold text-emerald-950 dark:text-emerald-100">ویترین اختصاصی من</h2>
                <p className="mt-1 text-xs leading-6 text-emerald-900 dark:text-emerald-300 sm:text-sm">
                  این لینک را برای خریداران بفرستید تا مستقیماً به محصولات و بارهای فعال شما دسترسی داشته باشند.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <input
                    readOnly
                    dir="ltr"
                    aria-label="لینک اختصاصی ویترین"
                    value={(origin || "") + "/store/" + encodeURIComponent(storefrontMemberId)}
                    className="field-input min-w-0 flex-1 bg-background text-left text-xs sm:text-sm"
                  />
                  <Button
                    type="button"
                    className="shrink-0"
                    onClick={async () => {
                      const link = window.location.origin + "/store/" + encodeURIComponent(storefrontMemberId);
                      try {
                        await navigator.clipboard.writeText(link);
                      } catch {
                        // ignore clipboard failure
                      }
                      setStoreLinkCopied(true);
                      window.setTimeout(() => setStoreLinkCopied(false), 2500);
                    }}
                  >
                    {storeLinkCopied ? <Check className="ml-2 size-4" /> : <Copy className="ml-2 size-4" />}
                    {storeLinkCopied ? "کپی شد" : "کپی لینک"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MAIN ANNOUNCE / EDIT FORM */}
        <div ref={mainFormRef} className="rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="grid size-12 place-items-center rounded-xl bg-primary/10 text-primary">
                {editingLoadId ? <Edit3 className="size-6" /> : <Megaphone className="size-6" />}
              </span>
              <div>
                <h1 className="text-2xl font-extrabold text-foreground">
                  {editingLoadId ? "ویرایش کامل اعلان بار" : "اعلام بار جدید"}
                </h1>
                <p className="mt-1 text-xs text-muted-foreground sm:text-sm">
                  {editingLoadId
                    ? "تمامی مشخصات، قیمت‌گذاری پلکانی، زمان‌بندی، پاسخگویی و تصاویر در فرم اصلی قابل ویرایش هستند."
                    : "انتشار مستقیم بار در بازار ترابار با ثبت خودکار در پایگاه داده."}
                </p>
              </div>
            </div>
            {editingLoadId && (
              <Button type="button" variant="outline" size="sm" onClick={resetToCreateForm}>
                <X className="ml-1 size-4" />
                انصراف از ویرایش
              </Button>
            )}
          </div>

          {editingLoadId && (
            <div className="mt-4 rounded-xl border border-amber-400/60 bg-amber-50 p-3 text-xs font-semibold text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
              شما در حال ویرایش یکی از بارهای ثبت‌شده هستید. پس از اتمام تغییرات، دکمه «ذخیره تغییرات بار» را بزنید.
            </div>
          )}

          {/* TWO SEPARATED ANNOUNCEMENT MODES */}
          <div className="mt-7">
            <span className="mb-2 block text-xs font-bold text-muted-foreground">نوع اعلان بار را انتخاب کنید:</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleModeSwitch("regular")}
                className={`relative cursor-pointer rounded-2xl border p-4 text-right transition-all ${
                  announcementType === "regular"
                    ? "border-emerald-600 bg-emerald-50/70 shadow-sm ring-2 ring-emerald-600/30 dark:bg-emerald-950/30"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-base font-extrabold ${
                      announcementType === "regular"
                        ? "text-emerald-950 dark:text-emerald-100"
                        : "text-foreground"
                    }`}
                  >
                    اعلان بار معمولی
                  </span>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    فروش درون‌شهری
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  عرضه فقط داخل شهر ثبت‌نامی شما ({userRegisteredCity}) · ویژه خریداران و بارفروشان همان شهر
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <MapPin className="size-3.5" />
                  محل عرضه: {userRegisteredCity} (ثابت)
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleModeSwitch("professional")}
                className={`relative cursor-pointer rounded-2xl border p-4 text-right transition-all ${
                  announcementType === "professional"
                    ? "border-blue-600 bg-blue-50/70 shadow-sm ring-2 ring-blue-600/30 dark:bg-blue-950/30"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-base font-extrabold ${
                      announcementType === "professional"
                        ? "text-blue-950 dark:text-blue-100"
                        : "text-foreground"
                    }`}
                  >
                    اعلان بار ویژه حرفه‌ای
                  </span>
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                    ارسال به شهر / شهرستان
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  عرضه اختصاصی در صفحه خرید ویژه حرفه‌ای با امکان ارسال سراسری برای خریداران عمده و حرفه‌ای
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold text-blue-800 dark:text-blue-300">
                  <Truck className="size-3.5" />
                  قابلیت ترانزیت و باربری بین‌شهری
                </div>
              </button>
            </div>
          </div>

          {savedMode ? (
            <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-8 text-center dark:border-emerald-900 dark:bg-emerald-950/30">
              <CheckCircle2 className="mx-auto mb-3 size-14 text-emerald-600" />
              <h2 className="text-xl font-extrabold text-emerald-950 dark:text-emerald-100">
                {savedMode === "updated" ? "تغییرات بار با موفقیت ذخیره شد" : "بار شما با موفقیت ثبت و منتشر شد"}
              </h2>
              <p className="mt-2 text-sm text-emerald-900 dark:text-emerald-300">
                اطلاعات بار هم‌اکنون در پایگاه داده به‌روزرسانی شده و در بخش انتخاب‌شده فعال است.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    setSavedMode(null);
                    resetToCreateForm();
                  }}
                >
                  ثبت اعلان بار جدید
                </Button>
                <Button asChild variant="outline">
                  <Link to={announcementType === "professional" ? "/professional-purchase" : "/requests"}>
                    مشاهده در بازار
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-6 grid gap-4">
              {announcementType === "regular" ? (
                <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3.5 text-xs leading-6 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-300">
                    <MapPin className="size-4" />
                    قوانین اعلان بار معمولی:
                  </div>
                  بار معمولی فقط برای فروش درون شهر ثبت‌نامی شما (<strong>{userRegisteredCity}</strong>) و شهرهای همجوار مجاز عرضه می‌شود.
                </div>
              ) : (
                <div className="rounded-xl border border-blue-200/80 bg-blue-50/70 p-3.5 text-xs leading-6 text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                  <div className="flex items-center gap-1.5 font-bold text-blue-800 dark:text-blue-300">
                    <Globe className="size-4" />
                    امکانات اعلان بار ویژه حرفه‌ای:
                  </div>
                  این بار صرفاً در صفحه مستقل «خرید ویژه حرفه‌ای» نمایش داده می‌شود و با بازار عادی مخلوط نمی‌گردد.
                </div>
              )}

              {/* Product Info */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="field-label">
                  نام محصول <span className="text-destructive">*</span>
                  <input
                    required
                    value={form.product}
                    onChange={(e) => setField("product")(e.target.value)}
                    className="field-input"
                    placeholder="مثلاً سیب، پرتقال، پیاز"
                  />
                </label>
                <label className="field-label">
                  رقم / نوع محصول <span className="text-destructive">*</span>
                  <input
                    required
                    value={form.variety}
                    onChange={(e) => setField("variety")(e.target.value)}
                    className="field-input"
                    placeholder="مثلاً تامسون، قرمز مراغه، زرد"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="field-label">
                  درجه کیفیت
                  <select
                    className="field-input"
                    value={form.quality}
                    onChange={(e) => setField("quality")(e.target.value)}
                  >
                    {qualities.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </label>
                <JalaliDateField
                  label="زمان آماده بودن بار (شمسی)"
                  value={form.ready}
                  onChange={(value) => setField("ready")(value)}
                />
              </div>

              {/* Location & Destination */}
              {announcementType === "regular" ? (
                <div className="grid grid-cols-1 gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/30 p-4 dark:border-emerald-900 dark:bg-emerald-950/20 sm:grid-cols-2">
                  <label className="field-label">
                    استان / مبدأ بار <span className="text-destructive">*</span>
                    <CityPicker
                      value={form.province}
                      onChange={(value) => setField("province")(value)}
                      id="load-province"
                      options={provinces}
                      placeholder="جست‌وجوی استان یا شهر مبدأ…"
                    />
                  </label>
                  <label className="field-label">
                    شهر محل عرضه بار (ثابت)
                    <input
                      readOnly
                      aria-readonly="true"
                      value={userRegisteredCity}
                      className="field-input cursor-not-allowed bg-muted font-bold text-foreground"
                    />
                    <span className="text-[11px] text-muted-foreground">
                      محل عرضه مطابق شهر ثبت‌نامی شما تنظیم می‌شود.
                    </span>
                  </label>
                </div>
              ) : (
                <div className="grid gap-3 rounded-xl border border-blue-200/80 bg-blue-50/30 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="field-label">
                      شهر یا استان مبدأ بارگیری <span className="text-destructive">*</span>
                      <CityPicker
                        value={form.province}
                        onChange={(value) => setField("province")(value)}
                        id="load-origin"
                        options={provinces}
                        placeholder="استان یا شهر مبدأ بارگیری…"
                      />
                    </label>

                    <label className="field-label">
                      نوع ناوگان و شرایط باربری بین‌شهری
                      <select
                        value={fleetType}
                        onChange={(e) => setFleetType(e.target.value)}
                        className="field-input"
                      >
                        <option>انواع باربری و ناوگان متناسب</option>
                        <option>وانت و نیسان باربری</option>
                        <option>کامیون خاور و ایسوزو (مسقف / روباز)</option>
                        <option>کامیون تک ۱۰ تن و جفت ۱۵ تن</option>
                        <option>تریلی کفی و چادری ترانزیت (۲۵ تن)</option>
                        <option>حمل با کانتینر یخچال‌دار / سردخانه‌ای</option>
                      </select>
                    </label>
                  </div>

                  <div>
                    <span className="field-label mb-1.5 block">پوشش ارسال به شهر / شهرستان‌های مقصد:</span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                          destinationScope === "all_country"
                            ? "border-blue-600 bg-blue-100/50 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100"
                            : "border-border bg-card"
                        }`}
                      >
                        <input
                          type="radio"
                          name="destinationScope"
                          checked={destinationScope === "all_country"}
                          onChange={() => setDestinationScope("all_country")}
                        />
                        ارسال به سراسر کشور (تمامی شهرستان‌ها)
                      </label>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-semibold ${
                          destinationScope === "specific_city"
                            ? "border-blue-600 bg-blue-100/50 text-blue-950 dark:bg-blue-950/50 dark:text-blue-100"
                            : "border-border bg-card"
                        }`}
                      >
                        <input
                          type="radio"
                          name="destinationScope"
                          checked={destinationScope === "specific_city"}
                          onChange={() => setDestinationScope("specific_city")}
                        />
                        ارسال به شهر / شهرستان مقصد مشخص
                      </label>
                    </div>

                    {destinationScope === "specific_city" && (
                      <div className="mt-3">
                        <label className="field-label">
                          شهر یا شهرستان مقصد <span className="text-destructive">*</span>
                          <CityPicker
                            value={destinationCity}
                            onChange={(value) => setDestinationCity(value)}
                            id="load-destination"
                            placeholder="جست‌وجوی شهرستان یا شهر مقصد…"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Schedule & Response Hours */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <JalaliDateField
                  label="شروع نمایش آگهی (شمسی)"
                  value={form.adStart}
                  min={editingLoadId ? undefined : localIsoDate()}
                  onChange={(value) =>
                    setForm((prev) => ({
                      ...prev,
                      adStart: value,
                      adEnd: prev.adEnd < value ? value : prev.adEnd,
                    }))
                  }
                />
                <JalaliDateField
                  label="پایان نمایش آگهی (شمسی)"
                  value={form.adEnd}
                  min={form.adStart || localIsoDate()}
                  onChange={(value) => setField("adEnd")(value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="field-label">
                  پاسخ‌گویی از ساعت
                  <input
                    required
                    type="time"
                    value={form.responseStart}
                    onChange={(e) => setField("responseStart")(e.target.value)}
                    className="field-input"
                  />
                </label>
                <label className="field-label">
                  پاسخ‌گویی تا ساعت
                  <input
                    required
                    type="time"
                    value={form.responseEnd}
                    min={form.responseStart}
                    onChange={(e) => setField("responseEnd")(e.target.value)}
                    className="field-input"
                  />
                </label>
              </div>

              {/* Packaging & Stock */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="field-label">
                  نوع بسته
                  <select
                    required
                    value={form.packageType}
                    onChange={(e) => setField("packageType")(e.target.value)}
                    className="field-input"
                  >
                    <option>کارتن</option>
                    <option>سبد</option>
                    <option>کیسه</option>
                    <option>جعبه</option>
                    <option>بسته‌بندی فله</option>
                    <option>بسته‌بندی صادراتی</option>
                  </select>
                </label>
                <label className="field-label">
                  وزن هر بسته (کیلو) <span className="text-destructive">*</span>
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={form.weight}
                    onChange={(e) => setField("weight")(normalizeNumericInput(e.target.value))}
                    className="field-input text-left"
                    placeholder="مثلاً 10"
                  />
                </label>
                <label className="field-label">
                  موجودی (تعداد بسته) <span className="text-destructive">*</span>
                  <input
                    required
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={form.stock}
                    onChange={(e) => setField("stock")(normalizeNumericInput(e.target.value))}
                    className="field-input text-left"
                    placeholder="مثلاً 500"
                  />
                </label>
              </div>

              {/* Sale Sections & Pricing */}
              <fieldset className="grid gap-3 rounded-2xl border border-border p-4">
                <legend className="px-2 font-bold text-foreground">
                  بخش‌های فروش و قیمت‌گذاری {announcementType === "professional" ? "ویژه حرفه‌ای" : "معمولی"}
                </legend>
                <p className="text-xs text-muted-foreground">
                  {announcementType === "professional"
                    ? "در اعلان حرفه‌ای، بار فقط در بخش خرید ویژه حرفه‌ای (با امکان افزودن فروش عمده حرفه‌ای) منتشر می‌شود."
                    : "در اعلان معمولی، می‌توانید بار را به تفکیک خرده‌فروشی، عمده‌فروشی یا فروش ویژه قیمت‌گذاری کنید."}
                </p>

                {salesSections
                  .filter((section) =>
                    announcementType === "professional"
                      ? section.key === "professional" || section.key === "wholesale"
                      : section.key !== "professional",
                  )
                  .map((section) => {
                    const enabled = saleSectionsEnabled.includes(section.key);
                    return (
                      <div key={section.key} className="grid gap-3 rounded-xl border border-border p-3.5">
                        <label className="flex items-center gap-2 text-sm font-bold">
                          <input
                            type="checkbox"
                            checked={enabled}
                            onChange={(e) => toggleSaleSection(section.key, e.target.checked)}
                          />
                          {section.label}
                        </label>
                        {enabled && (
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <label className="field-label">
                              قیمت هر کیلو (تومان) <span className="text-destructive">*</span>
                              <input
                                required
                                type="text"
                                inputMode="decimal"
                                dir="ltr"
                                value={salePrices[section.key]}
                                onChange={(e) =>
                                  setSalePrices((prev) => ({
                                    ...prev,
                                    [section.key]: normalizeNumericInput(e.target.value),
                                  }))
                                }
                                className="field-input text-left"
                                placeholder="حداقل 10000 تومان"
                              />
                            </label>
                            <label className="field-label">
                              حداقل تعداد بسته برای سفارش <span className="text-destructive">*</span>
                              <input
                                required
                                type="text"
                                inputMode="decimal"
                                dir="ltr"
                                value={saleMinimums[section.key]}
                                onChange={(e) =>
                                  setSaleMinimums((prev) => ({
                                    ...prev,
                                    [section.key]: normalizeNumericInput(e.target.value),
                                  }))
                                }
                                className="field-input text-left"
                                placeholder={`پیش‌فرض: ${section.defaultMin}`}
                              />
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </fieldset>

              {/* Photos Management (Existing + New) */}
              <div className="grid gap-3 rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                    <ImagePlus className="size-4 text-primary" />
                    تصاویر بار (حداکثر ۵ تصویر)
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {faNumber(totalImagesCount)} از ۵ تصویر
                  </span>
                </div>

                {existingImages.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">تصاویر ثبت‌شده فعلی:</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {existingImages.map((img) => (
                        <div
                          key={img.storage_path}
                          className="relative overflow-hidden rounded-xl border border-border bg-muted"
                        >
                          <img
                            src={`/api/storage/file/${encodeURIComponent(img.storage_path)}`}
                            alt="تصویر بار"
                            className="aspect-square w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setExistingImages((prev) =>
                                prev.filter((item) => item.storage_path !== img.storage_path),
                              );
                              setRemovedImageKeys((prev) => [...prev, img.storage_path]);
                            }}
                            className="absolute top-1.5 left-1.5 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                            aria-label="حذف تصویر فعلی"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {photoPreviews.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">تصاویر جدید انتخاب‌شده برای آپلود:</p>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {photoPreviews.map((url, idx) => (
                        <div
                          key={url}
                          className="relative overflow-hidden rounded-xl border border-primary/40 bg-muted"
                        >
                          <img src={url} alt={`پیش‌نمایش ${idx + 1}`} className="aspect-square w-full object-cover" />
                          <button
                            type="button"
                            onClick={() =>
                              setPhotoFiles((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="absolute top-1.5 left-1.5 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                            aria-label="حذف تصویر جدید"
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {totalImagesCount < 5 && (
                  <label className="field-label">
                    افزودن عکس جدید (JPEG، PNG یا WebP، حداکثر ۱۰ مگابایت)
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(e) => {
                        const allowedCount = Math.max(0, 5 - existingImages.length);
                        const selected = Array.from(e.target.files ?? []);
                        setPhotoFiles((prev) => [...prev, ...selected].slice(0, allowedCount));
                        e.target.value = "";
                      }}
                      className="field-input"
                    />
                  </label>
                )}
              </div>

              {/* Description */}
              <label className="field-label">
                توضیحات تکمیلی
                <textarea
                  value={form.description}
                  onChange={(e) => setField("description")(e.target.value)}
                  className="field-input min-h-24 resize-y"
                  placeholder="جزئیات بسته‌بندی، سورتینگ، شرایط بارگیری، هماهنگی باسکول یا تحویل…"
                />
              </label>

              {error && <p className="text-sm font-semibold text-destructive">{error}</p>}

              <div className="flex flex-wrap gap-3">
                <Button type="submit" size="lg" disabled={busy} className="h-12 flex-1 text-base font-extrabold">
                  {busy
                    ? "در حال ذخیره‌سازی…"
                    : editingLoadId
                      ? "ذخیره تغییرات بار در فرم اصلی"
                      : announcementType === "professional"
                        ? "ثبت و انتشار در خرید ویژه حرفه‌ای"
                        : "ثبت و انتشار بار در بازار"}
                </Button>
                {editingLoadId && (
                  <Button type="button" size="lg" variant="outline" onClick={resetToCreateForm}>
                    انصراف
                  </Button>
                )}
              </div>
            </form>
          )}
        </div>

        {/* INCOMING ORDERS SECTION */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-bold">درخواست‌های سفارش و مدیریت ارسال بارهای من</h2>
          {loadingIncomingOrders ? (
            <p className="mt-3 text-sm text-muted-foreground">در حال دریافت سفارش‌ها…</p>
          ) : incomingOrders.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">هنوز سفارشی برای بارهای شما ثبت نشده است.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {incomingOrders.map((order) => (
                <li key={order.id} className="rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-bold">
                        {order.invoice_number ? `فاکتور ${faNumber(order.invoice_number)} · ` : ""}
                        {order.customer_name} · {order.customer_city}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {faNumber(Number(order.quantity))} {order.unit || "بسته"} ·{" "}
                        {faNumber(Number(order.total_price))} تومان ·{" "}
                        {order.delivery_type === "pickup" ? "تحویل حضوری" : "ارسال با ناوگان ترابار"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        پرداخت: {paymentStatusLabels[order.payment_status] ?? order.payment_status} · تحویل:{" "}
                        {deliveryStatusLabels[order.delivery_status] ?? order.delivery_status}
                      </p>
                      {order.customer_phone && (
                        <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
                          تلفن خریدار: {order.customer_phone}
                        </p>
                      )}
                      {order.delivery_address && (
                        <p className="mt-1 text-xs text-muted-foreground">نشانی: {order.delivery_address}</p>
                      )}
                      {order.notes && (
                        <p className="mt-1 text-xs text-muted-foreground">توضیح خریدار: {order.notes}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                      {orderStatusLabels[order.status] ?? order.status}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.status === "pending" && (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyActionId === order.id}
                          onClick={() => void handleOrderAction(order.id, "accept")}
                        >
                          تأیید سفارش و کسر موجودی
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyActionId === order.id}
                          onClick={() => void handleOrderAction(order.id, "reject")}
                        >
                          رد سفارش
                        </Button>
                      </>
                    )}
                    {order.status === "accepted" && order.payment_status !== "paid" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyActionId === order.id}
                        onClick={() => void handleOrderAction(order.id, "mark_paid")}
                      >
                        تأیید تسویه مالی / ثبت ۵٪ کارمزد
                      </Button>
                    )}
                    {order.status === "accepted" &&
                      !["shipped", "delivered"].includes(order.delivery_status) && (
                        <Button
                          type="button"
                          size="sm"
                          disabled={busyActionId === order.id}
                          onClick={() => void handleOrderAction(order.id, "ship")}
                        >
                          ثبت ارسال بار
                        </Button>
                      )}
                    {order.status === "accepted" && order.delivery_status === "shipped" && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busyActionId === order.id}
                        onClick={() => void handleOrderAction(order.id, "deliver")}
                      >
                        ثبت تحویل به خریدار
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* OWNED LOADS MANAGEMENT */}
        <div className="mt-8 rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-bold">مدیریت بارهای ثبت‌شده من</h2>
          {loadingOwnedLoads ? (
            <p className="mt-3 text-sm text-muted-foreground">در حال بارگذاری بارهای شما…</p>
          ) : ownedLoads.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">هنوز باری در این حساب کاربری ثبت نشده است.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {ownedLoads.map((load) => {
                const isProLoad =
                  load.sale_type === "professional" ||
                  load.city === "سراسر کشور" ||
                  Boolean(load.tiers?.some((t) => t.sale_type === "professional"));
                return (
                  <li
                    key={load.id}
                    className={`rounded-xl border p-4 ${
                      editingLoadId === load.id ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-extrabold text-foreground">
                            {load.product_type || load.name}
                            {load.engine ? ` · ${load.engine}` : ""}
                          </p>
                          {isProLoad ? (
                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                              ویژه حرفه‌ای
                            </span>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                              معمولی (شهری)
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          محل عرضه: {load.city} · موجودی: {faNumber(Number(load.count ?? 0))} بسته · پایه قیمت:{" "}
                          {faNumber(Number(load.price))} تومان/کیلو
                        </p>
                        {(load.ad_start_date || load.response_start_time) && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {load.ad_start_date && load.ad_end_date
                              ? `نمایش: ${load.ad_start_date} تا ${load.ad_end_date}`
                              : ""}
                            {load.response_start_time && load.response_end_time
                              ? ` · پاسخگویی: ${load.response_start_time} تا ${load.response_end_time}`
                              : ""}
                          </p>
                        )}
                      </div>
                      <span className="rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
                        {loadStatusLabels[load.status] ?? load.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(busyActionId)}
                        onClick={() => void startEditInMainForm(load)}
                      >
                        <Edit3 className="ml-1 size-3.5" />
                        ویرایش بار در فرم اصلی
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={Boolean(busyActionId)}
                        onClick={() => void toggleLoadStatus(load)}
                      >
                        {load.status === "active" ? "غیرفعال‌کردن" : "فعال‌سازی مجدد"}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={Boolean(busyActionId)}
                        onClick={() => void deleteLoad(load)}
                      >
                        حذف بار
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
