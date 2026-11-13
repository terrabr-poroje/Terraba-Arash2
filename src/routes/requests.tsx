/* eslint-disable @typescript-eslint/no-explicit-any */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import {
  CheckCircle2,
  ChevronDown,
  PackageCheck,
  Plus,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { LoadCard } from "@/components/load-card";
import {
  faNumber,
  loads as sampleLoads,
  normalizeNumericInput,
  pageHead,
  qualities,
  type Load,
  type Quality,
} from "@/lib/marketplace";

export const Route = createFileRoute("/requests")({
  head: () => pageHead("درخواست خرید", "جست‌وجوی بارهای مجاز و ثبت درخواست سفارش چندمحصولی در ترابار.", "/requests"),
  component: Requests,
});

type DirectOrderItem = { product: string; variety: string; quantity: string; unit: "kg" | "package" | "ton"; quality: string };
type MyDirectRequest = {
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
  created_at: string;
};
type MyOrder = {
  id: string;
  invoice_number: number;
  load_id: string;
  quantity: number;
  unit: string;
  total_price: number | null;
  delivery_type: string | null;
  delivery_address: string | null;
  status: string;
  payment_status: string;
  paid_at: string | null;
  delivery_status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string;
};

const orderStatusLabels: Record<string, string> = {
  pending: "در انتظار تأیید فروشنده",
  accepted: "تأیید فروشنده؛ در انتظار ارسال/پرداخت",
  rejected: "رد شده توسط فروشنده",
  paid: "پرداخت‌شده",
  shipped: "بار ارسال شده",
  bar_sent: "بار ارسال شده",
  delivered: "تحویل گرفته شده",
  received: "تحویل گرفته شده",
  completed: "تکمیل‌شده",
  cancelled: "لغوشده",
};
const directStatusLabels: Record<string, string> = {
  new: "ثبت‌شده",
  open: "ثبت‌شده",
  in_review: "در حال بررسی",
  sourcing: "در حال تأمین",
  offer_ready: "پیشنهاد تأمین آماده",
  matched: "پیشنهاد تأمین آماده",
  rejected: "ردشده",
  cancelled: "لغوشده",
  closed: "تکمیل‌شده",
  completed: "تکمیل‌شده",
};
const paymentStatusLabels: Record<string, string> = {
  unpaid: "پرداخت‌نشده",
  pending: "در انتظار تأیید پرداخت",
  paid: "پرداخت تأییدشده",
  failed: "پرداخت ناموفق",
  refunded: "بازپرداخت‌شده",
};
const deliveryStatusLabels: Record<string, string> = {
  pending: "در انتظار بررسی",
  awaiting_payment: "در انتظار پرداخت",
  awaiting_dispatch: "آماده ارسال",
  shipped: "بار ارسال شده",
  delivered: "تحویل گرفته شده",
  disputed: "در حال بررسی اختلاف",
};

const emptyItem = (): DirectOrderItem => ({ product: "", variety: "", quantity: "", unit: "kg", quality: "توافقی" });

const normalizeDigits = (value: string) =>
  value
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));

const jalaliToIsoDate = (value: string): string | null => {
  const match = normalizeDigits(value.trim()).match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return null;
  const jy = Number(match[1]),
    jm = Number(match[2]),
    jd = Number(match[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian-nu-latn", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
  const start = Date.UTC(jy + 621, 0, 1);
  const end = Date.UTC(jy + 623, 0, 1);
  for (let time = start; time < end; time += 86400000) {
    const parts = Object.fromEntries(
      fmt
        .formatToParts(new Date(time))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, Number(p.value)]),
    );
    if (parts.year === jy && parts.month === jm && parts.day === jd) return new Date(time).toISOString().slice(0, 10);
  }
  return null;
};

export function Requests({ ordersOnly = false, professionalOnly = false }: { ordersOnly?: boolean; professionalOnly?: boolean } = {}) {
  const { user, member, roles, canAccessProfessionalPurchase } = useAuth();
  const [profileCity, setProfileCity] = useState("");
  const [allowedCities, setAllowedCities] = useState<string[]>([]);
  const [cityAccess, setCityAccess] = useState<"own" | "nearby" | "all" | "assigned" | "unavailable">("unavailable");
  const [cityAccessReady, setCityAccessReady] = useState(false);

  const [myDirectRequests, setMyDirectRequests] = useState<MyDirectRequest[]>([]);
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [loadingMyRequests, setLoadingMyRequests] = useState(false);
  const [myRequestError, setMyRequestError] = useState("");
  const [orderActionBusyId, setOrderActionBusyId] = useState("");

  const [liveLoads, setLiveLoads] = useState<Load[]>([]);
  const [loadingLoads, setLoadingLoads] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [selectedSaleTypes, setSelectedSaleTypes] = useState<string[]>(["retail", "wholesale", "special"]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [selectedQualities, setSelectedQualities] = useState<string[]>([]);
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [city, setCity] = useState("");
  const [category, setCategory] = useState("");
  const [quality, setQuality] = useState("");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState({ city: "", category: "", quality: "", query: "" });
  const [sort, setSort] = useState("newest");

  const [orderItems, setOrderItems] = useState<DirectOrderItem[]>([emptyItem()]);
  const [neededBy, setNeededBy] = useState("");
  const [neededByError, setNeededByError] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderError, setOrderError] = useState("");
  const [orderSaved, setOrderSaved] = useState(false);

  const CART_KEY = "terrabar-cart-items";
  const CART_TTL_MS = 6 * 60 * 60 * 1000;
  type CartLine = { load: Load; quantity: number; saleType: string; expiresAt?: number };
  const readValidCart = (): CartLine[] => {
    try {
      const raw = window.localStorage.getItem(CART_KEY) ?? window.sessionStorage.getItem(CART_KEY) ?? "[]";
      const now = Date.now();
      const parsed = JSON.parse(raw) as CartLine[];
      const valid = Array.isArray(parsed)
        ? parsed
            .map((item) => ({ ...item, expiresAt: Number(item.expiresAt) || now + CART_TTL_MS }))
            .filter((item) => item.expiresAt! > now)
        : [];
      window.localStorage.setItem(CART_KEY, JSON.stringify(valid));
      window.sessionStorage.removeItem(CART_KEY);
      return valid;
    } catch {
      return [];
    }
  };
  const [cartItems, setCartItems] = useState<CartLine[]>([]);
  const [cartError, setCartError] = useState("");
  const [cartNotice, setCartNotice] = useState("");

  useEffect(() => {
    setCartItems(readValidCart());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
      window.sessionStorage.removeItem(CART_KEY);
      window.dispatchEvent(new Event("terrabar-cart-updated"));
    } catch {
      // ignore
    }
    if (user) {
      if (cartItems.length === 0) {
        void apiDelete("/api/cart").catch(() => {});
      } else {
        void apiPost("/api/cart", {
          items: cartItems.map((item) => ({
            loadId: String(item.load.id),
            saleType: item.saleType,
            quantity: item.quantity,
            expiresAt: item.expiresAt,
          })),
        }).catch(() => {});
      }
    }
  }, [cartItems, user?.id]);

  useEffect(() => {
    const expireCartItems = () => {
      const valid = readValidCart();
      setCartItems((current) => (JSON.stringify(current) === JSON.stringify(valid) ? current : valid));
      window.dispatchEvent(new Event("terrabar-cart-updated"));
    };
    const timer = window.setInterval(expireCartItems, 30_000);
    window.addEventListener("focus", expireCartItems);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", expireCartItems);
    };
  }, []);

  // Resolve City Access strictly from D1 backend
  useEffect(() => {
    let active = true;
    async function resolveCityAccess() {
      setCityAccessReady(false);
      if (!user) {
        setProfileCity("");
        setAllowedCities([]);
        setCityAccess("unavailable");
        setCityAccessReady(true);
        return;
      }
      try {
        const { ok, data } = await apiGet<any>("/api/account/city-access");
        if (!active) return;
        if (ok && data?.success) {
          setProfileCity(String(data.city || member?.city || user.city || "").trim());
          setAllowedCities(Array.isArray(data.allowedCities) ? data.allowedCities : []);
          setCityAccess(data.accessMode || "own");
        } else {
          const ownCity = String(member?.city || user.city || "").trim();
          setProfileCity(ownCity);
          setAllowedCities(ownCity ? [ownCity] : []);
          setCityAccess(ownCity ? "own" : "unavailable");
        }
      } catch {
        if (!active) return;
        const ownCity = String(member?.city || user.city || "").trim();
        setProfileCity(ownCity);
        setAllowedCities(ownCity ? [ownCity] : []);
        setCityAccess(ownCity ? "own" : "unavailable");
      } finally {
        if (active) setCityAccessReady(true);
      }
    }
    void resolveCityAccess();
    return () => {
      active = false;
    };
  }, [user?.id, member?.city]);

  // Record Search Visit
  useEffect(() => {
    if (!user || ordersOnly) return;
    const routePath = professionalOnly ? "/professional-purchase" : "/requests";
    const storageKey = `terrabar:visit:${routePath}:${user.id}`;
    const now = Date.now();
    const previous = Number(sessionStorage.getItem(storageKey) || 0);
    if (previous && now - previous < 30 * 60 * 1000) return;

    apiPost("/api/visits/record", { route: routePath })
      .then(({ ok }) => {
        if (ok) sessionStorage.setItem(storageKey, String(now));
      })
      .catch(() => {});
  }, [user?.id, ordersOnly, professionalOnly]);

  // Fetch Loads (market vs professional strictly separated by backend mode)
  useEffect(() => {
    let active = true;
    async function fetchLoads() {
      if (ordersOnly || !cityAccessReady) return;
      if (!user) {
        setLoadingLoads(false);
        return;
      }
      setLoadingLoads(true);
      setLoadError("");
      try {
        const mode = professionalOnly ? "professional" : "market";
        const { ok, data } = await apiGet<any>(`/api/loads/list?mode=${mode}&status=active`);
        if (!active) return;

        if (!ok || !data?.success) {
          setLoadError(data?.message || "دریافت بارها با خطا مواجه شد.");
          setLiveLoads([]);
          return;
        }

        if (data.accessDenied) {
          setLiveLoads([]);
          return;
        }

        const rows = Array.isArray(data.loads) ? data.loads : [];
        setLiveLoads(
          rows.map((row: any) => {
            const packageCount = Math.max(0, Number(row.count ?? 0));
            const quantity = Math.max(0, Number(row.quantity ?? 0));
            const weight =
              Number(row.package_weight) > 0
                ? Number(row.package_weight)
                : packageCount > 0
                  ? Math.max(1, Math.round(quantity / packageCount))
                  : 1;
            const product = String(row.product_type || row.name || "محصول");
            const rawQuality = String(row.quality || "").toLowerCase();
            const qualityMap: Record<string, Quality> = {
              special: "ویژه",
              premium: "ویژه",
              "ویژه": "ویژه",
              standard: "استاندارد",
              "استاندارد": "استاندارد",
              economical: "اقتصادی",
              economy: "اقتصادی",
              "اقتصادی": "اقتصادی",
              negotiable: "توافقی",
              "توافقی": "توافقی",
            };
            const cat = /گوجه|پیاز|خیار|سیب‌زمینی|بادمجان|فلفل/.test(product)
              ? "صیفی‌جات"
              : /سبزی|جعفری|گشنیز|شوید|کاهو/.test(product)
                ? "سبزیجات"
                : "میوه";

            const rowTiers = Array.isArray(row.tiers) ? row.tiers : [];
            const legacyType = String(row.sale_type || "regular");
            const saleOptions = rowTiers.length
              ? [...new Set<string>(rowTiers.map((tier: any) => String(tier.sale_type)))].map((key) => {
                  const labels: Record<string, string> = {
                    retail: "خرده‌فروشی",
                    wholesale: "عمده‌فروشی",
                    special: "فروش ویژه",
                    professional: "ویژه حرفه‌ای",
                    regular: "فروش عادی",
                    pro: "ویژه حرفه‌ای",
                  };
                  const typedTiers = rowTiers.filter((tier: any) => String(tier.sale_type) === key);
                  const breaks = typedTiers
                    .map((tier: any) => ({
                      minQuantity: Math.max(1, Number(tier.min_quantity ?? tier.minimum_packages ?? 1)),
                      maxQuantity: tier.max_quantity == null ? null : Number(tier.max_quantity),
                      price: Number(tier.unit_price),
                    }))
                    .sort((a: any, b: any) => a.minQuantity - b.minQuantity);
                  const first = breaks[0];
                  const pkgMins = typedTiers
                    .map((t: any) => Number(t.minimum_packages))
                    .filter((v: number) => Number.isFinite(v) && v > 0);
                  const minimum = pkgMins.length ? Math.min(...pkgMins) : Number(row.min_order_quantity ?? 1);
                  return {
                    saleType: key,
                    label: labels[key] || key,
                    price: Number(first?.price ?? row.price) || 0,
                    minimum: Math.max(1, minimum),
                    priceBreaks: breaks,
                  };
                })
              : [
                  {
                    saleType: legacyType,
                    label: "قیمت پایه",
                    price: Number(row.price) || 0,
                    minimum: Math.max(1, Number(row.min_order_quantity ?? 1)),
                  },
                ];

            const firstImage =
              Array.isArray(row.images) && row.images.length
                ? row.images[0].storage_path?.startsWith("/") || row.images[0].storage_path?.startsWith("http")
                  ? row.images[0].storage_path
                  : `/api/storage/file/${encodeURIComponent(row.images[0].storage_path)}`
                : sampleLoads[0]?.image ?? "";

            return {
              id: row.id,
              memberId: String(row.member_id || ""),
              saleType: legacyType,
              saleOptions,
              packageType: String(row.package_type || "کارتن"),
              createdAt: String(row.created_at || ""),
              product,
              variety: String(row.engine || row.source_market || ""),
              category: cat,
              quality: qualityMap[rawQuality] ?? "توافقی",
              city: String(row.city || ""),
              province: String(row.source_region || row.origin || ""),
              weight,
              stock: packageCount || Math.floor(quantity / weight),
              minimum: Math.max(1, Number(row.min_order_quantity ?? 1)),
              price: Number(row.price) || 0,
              ready: row.ready_date ? new Date(row.ready_date).toLocaleDateString("fa-IR") : "زمان بارگیری هماهنگ شود",
              validity: row.ad_end_date ? `تا ${new Date(row.ad_end_date).toLocaleDateString("fa-IR")}` : "طبق وضعیت بار",
              seller: String(row.member_name || "عضو تأییدشدهٔ ترابار"),
              sellerType: String(row.seller_type || row.role || "فروشنده"),
              image: firstImage,
              images: row.images || [],
              description: row.description || "",
              adStart: row.ad_start_date || "",
              adEnd: row.ad_end_date || "",
              responseStart: row.response_start_time || "",
              responseEnd: row.response_end_time || "",
              isSample: false,
            } as Load;
          }),
        );
      } catch {
        if (active) setLoadError("دریافت بارهای فعال با خطا مواجه شد. لطفاً دوباره تلاش کنید.");
      } finally {
        if (active) setLoadingLoads(false);
      }
    }
    void fetchLoads();
    return () => {
      active = false;
    };
  }, [cityAccessReady, user?.id, ordersOnly, professionalOnly]);

  async function refreshOrdersAndDirectRequests() {
    if (!user) return;
    setLoadingMyRequests(true);
    setMyRequestError("");
    try {
      const [reqRes, ordRes] = await Promise.all([
        apiGet<any>("/api/purchase-requests/list?onlyDirect=true"),
        apiGet<any>("/api/orders/list"),
      ]);
      if (reqRes.ok && Array.isArray(reqRes.data?.requests)) {
        setMyDirectRequests(reqRes.data.requests);
      }
      if (ordRes.ok && Array.isArray(ordRes.data?.orders)) {
        setMyOrders(ordRes.data.orders);
      }
    } catch {
      setMyRequestError("دریافت سوابق سفارش‌ها با خطا مواجه شد.");
    } finally {
      setLoadingMyRequests(false);
    }
  }

  useEffect(() => {
    if (!user || !ordersOnly) return;
    void refreshOrdersAndDirectRequests();
  }, [user?.id, ordersOnly]);

  const canUseProfessional = canAccessProfessionalPurchase;
  const displayLoads = useMemo(() => (import.meta.env.DEV ? [...liveLoads, ...sampleLoads] : liveLoads), [liveLoads]);
  const normalizedQuery = filters.query.trim().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/\s/g, "");
  const availableProducts = [...new Set(displayLoads.map((load) => load.product).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fa"),
  );

  const filtered = displayLoads
    .filter((load) => {
      const options = load.saleOptions?.length
        ? load.saleOptions
        : [{ saleType: String(load.saleType || "regular"), label: "قیمت پایه", price: load.price, minimum: load.minimum }];
      const normalizeValue = (value: unknown) =>
        String(value ?? "")
          .trim()
          .toLowerCase()
          .replace(/[يى]/g, "ی")
          .replace(/ك/g, "ک")
          .replace(/\s+/g, "");
      const normalizedOptions = options.map((option) => ({ ...option, saleType: normalizeValue(option.saleType) }));
      const isProfessionalInventory =
        normalizedOptions.some((option) => ["professional", "pro"].includes(option.saleType)) ||
        normalizeValue(load.saleType).includes("pro") ||
        normalizeValue(load.city).includes("سراسر");

      // Strict separation: professionalOnly shows ONLY professional inventory; regular market shows ONLY non-professional
      if (professionalOnly && !isProfessionalInventory) return false;
      if (!professionalOnly && isProfessionalInventory) return false;

      const normalizedLoadCity = normalizeValue(load.city);
      const normalizedAllowedCities = allowedCities.map(normalizeValue);
      const cityAllowed = professionalOnly
        ? true
        : cityAccess === "all"
          ? true
          : cityAccess === "unavailable"
            ? false
            : normalizedAllowedCities.includes(normalizedLoadCity);

      const normalizedSelectedTypes = selectedSaleTypes.map(normalizeValue);
      const optionAllowed = professionalOnly
        ? isProfessionalInventory
        : normalizedOptions.some((option) => {
            if (["professional", "pro"].includes(option.saleType)) return false;
            if (option.saleType === "retail") return normalizedSelectedTypes.includes("retail");
            if (option.saleType === "wholesale") return normalizedSelectedTypes.includes("wholesale");
            if (option.saleType === "special") return normalizedSelectedTypes.includes("special");
            if (option.saleType === "regular")
              return normalizedSelectedTypes.includes("retail") || normalizedSelectedTypes.includes("wholesale");
            return normalizedSelectedTypes.includes(option.saleType);
          });

      return (
        cityAllowed &&
        optionAllowed &&
        (!selectedProducts.length || selectedProducts.includes(load.product)) &&
        (!selectedQualities.length || selectedQualities.includes(load.quality)) &&
        (!minPrice || load.price >= Number(normalizeNumericInput(minPrice))) &&
        (!maxPrice || load.price <= Number(normalizeNumericInput(maxPrice))) &&
        (!normalizedQuery || `${load.product}${load.variety}`.replace(/\s/g, "").includes(normalizedQuery))
      );
    })
    .sort((a, b) =>
      sort === "price"
        ? a.price - b.price
        : sort === "stock"
          ? b.stock - a.stock
          : (Date.parse(b.createdAt || "") || Number(b.id) || 0) - (Date.parse(a.createdAt || "") || Number(a.id) || 0),
    );

  function addToCart(load: Load, qty: number, saleType: string) {
    if (load.isSample) {
      setCartError("بار نمونه قابل ثبت در سفارش واقعی نیست.");
      return;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > load.stock) {
      setCartError("تعداد باید عدد صحیح و در محدوده موجودی باشد.");
      return;
    }
    const option = load.saleOptions?.find((item) => item.saleType === saleType);
    if (!option || qty < option.minimum) {
      setCartError(`حداقل سفارش این بخش ${faNumber(option?.minimum ?? load.minimum)} بسته است.`);
      return;
    }
    setCartError("");
    setCartNotice(`«${load.product}» به سبد خرید اضافه شد.`);
    setCartItems((items) => {
      const found = items.find((item) => String(item.load.id) === String(load.id) && item.saleType === saleType);
      if (!found) return [...items, { load, quantity: qty, saleType, expiresAt: Date.now() + CART_TTL_MS }];
      return items.map((item) =>
        item === found
          ? { ...item, quantity: Math.min(load.stock, item.quantity + qty), expiresAt: Date.now() + CART_TTL_MS }
          : item,
      );
    });
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setFilters({ city, category, quality, query });
    document
      .getElementById("market-loads")
      ?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
        block: "start",
      });
  }

  function reset() {
    setCity("");
    setCategory("");
    setQuality("");
    setQuery("");
    setSelectedSaleTypes(["retail", "wholesale", "special"]);
    setSelectedProducts([]);
    setSelectedQualities([]);
    setMinPrice("");
    setMaxPrice("");
    setFilters({ city: "", category: "", quality: "", query: "" });
  }

  function updateItem(index: number, key: keyof DirectOrderItem, value: string) {
    setOrderItems((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)));
  }

  async function submitDirectOrder(event: FormEvent) {
    event.preventDefault();
    setOrderBusy(true);
    setOrderError("");
    setOrderSaved(false);
    const invalid = orderItems.some(
      (item) =>
        !item.product.trim() ||
        !Number.isFinite(Number(normalizeNumericInput(item.quantity))) ||
        Number(normalizeNumericInput(item.quantity)) <= 0,
    );
    if (invalid) {
      setOrderError("برای هر ردیف، نام محصول و مقدار مثبت وارد کنید.");
      setOrderBusy(false);
      return;
    }

    if (!user) {
      setOrderError("برای ثبت درخواست سفارش ابتدا وارد حساب خود شوید.");
      setOrderBusy(false);
      return;
    }

    const normalizedNeededBy = neededBy.trim() ? jalaliToIsoDate(neededBy) : null;
    if (neededBy.trim() && !normalizedNeededBy) {
      setNeededByError("تاریخ شمسی را به شکل ۱۴۰۵/۰۷/۲۹ وارد کنید.");
      setOrderBusy(false);
      return;
    }
    setNeededByError("");

    const buyerCity = profileCity || member?.city || user.city || "کرج";
    try {
      for (const item of orderItems) {
        const { ok, data } = await apiPost<any>("/api/purchase-requests/create", {
          loadId: null,
          productType: item.product.trim(),
          quantity: Number(normalizeNumericInput(item.quantity)),
          quantityUnit: item.unit,
          destinationCity: buyerCity,
          qualityRequirements: [item.variety.trim(), item.quality].filter(Boolean).join(" — "),
          neededBy: normalizedNeededBy || undefined,
          notes: orderNotes.trim() || undefined,
        });
        if (!ok || !data?.success) {
          setOrderError(data?.message || "ثبت درخواست خرید انجام نشد.");
          setOrderBusy(false);
          return;
        }
      }

      setOrderSaved(true);
      setOrderItems([emptyItem()]);
      setNeededBy("");
      setOrderNotes("");
      await refreshOrdersAndDirectRequests();
    } catch {
      setOrderError("خطا در برقراری ارتباط با سرور هنگام ثبت درخواست.");
    } finally {
      setOrderBusy(false);
    }
  }

  async function confirmOrderDelivered(orderId: string) {
    setOrderActionBusyId(orderId);
    try {
      const { ok, data } = await apiPost<any>("/api/orders/update-status", {
        orderId,
        action: "deliver",
      });
      if (!ok || !data?.success) {
        toast.error(data?.message || "ثبت تحویل انجام نشد.");
        return;
      }
      toast.success("تحویل سفارش ثبت شد.");
      await refreshOrdersAndDirectRequests();
    } catch {
      toast.error("خطا در ثبت وضعیت تحویل.");
    } finally {
      setOrderActionBusyId("");
    }
  }

  if (!user) {
    return (
      <section className="bg-market-surface py-16">
        <div className="site-container max-w-lg">
          <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-8">
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-accent text-primary">
              <Search className="size-7" />
            </div>
            <h1 className="mt-4 text-2xl font-extrabold">برای جست‌وجوی بار وارد ترابار شوید</h1>
            <p className="mt-3 text-sm leading-7 text-muted-foreground">
              برای مشاهده بارهای فعال متناسب با شهر و سطح دسترسی، ابتدا ثبت‌نام کنید یا وارد حساب خود شوید.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Link
                to="/auth"
                onClick={() => sessionStorage.setItem("terrabar:after-auth", professionalOnly ? "/professional-purchase" : "/requests")}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-bold text-primary-foreground"
              >
                ثبت‌نام / ورود
              </Link>
              <Link
                to="/"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-3 text-sm font-semibold"
              >
                بازگشت به صفحه اصلی
              </Link>
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (professionalOnly && !canUseProfessional) {
    return (
      <section dir="rtl" className="bg-market-surface py-16">
        <div className="site-container max-w-xl rounded-2xl border border-border bg-card p-6 text-center">
          <h1 className="text-xl font-extrabold">خرید ویژه حرفه‌ای</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            این بخش مخصوص خریداران ویژه، بارفروشان و تأمین‌کنندگان تأییدشده است. بارهای ویژه حرفه‌ای صرفاً در این بازار مستقل نمایش داده می‌شوند و با بازار عادی مخلوط نمی‌شوند.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Link to="/membership" className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
              درخواست عضویت خریدار ویژه
            </Link>
            <Link to="/member-home" className="inline-flex rounded-lg border border-border px-4 py-2 text-sm font-semibold">
              بازگشت به صفحه اصلی کاربر
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const activePurchaseMode = professionalOnly ? "professional" : "retail";

  return (
    <>
      {!ordersOnly && (
        <>
          <section
            aria-label={professionalOnly ? "بارهای ویژه حرفه‌ای" : "جست‌وجوی بازار"}
            className="relative border-b border-border bg-market-surface"
          >
            <div className="site-container py-4 sm:py-5">
              <div className="mb-3 rounded-2xl bg-emerald-950 px-4 py-4 text-white shadow-sm sm:px-6">
                <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-emerald-200">
                  <span className="size-2 rounded-full bg-lime-300" />
                  {professionalOnly ? "بازار مستقل حرفه‌ای" : "بازار خرید"}
                </div>
                <h1 className="text-xl font-extrabold sm:text-2xl">
                  {professionalOnly ? (
                    <>
                      خرید ویژه حرفه‌ای <span className="text-lime-300">ترابار</span>
                    </>
                  ) : (
                    <>
                      بازار خرید <span className="text-lime-300">ترابار</span>
                    </>
                  )}
                </h1>
                <p className="mt-1.5 text-xs leading-5 text-emerald-50/90 sm:text-sm">
                  {professionalOnly
                    ? "فقط بارهای موجود با قیمت‌گذاری ویژه حرفه‌ای؛ این آگهی‌ها در بازار عادی و درخواست خرید عادی مخلوط نمی‌شوند."
                    : "بارهای مجاز شهر حساب شما؛ آگهی‌های ویژه حرفه‌ای در صفحه مستقل خرید حرفه‌ای نمایش داده می‌شوند."}
                </p>
              </div>

              {!professionalOnly && cityAccessReady && cityAccess === "unavailable" && (
                <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                  شهر محل فعالیت در حساب شما ثبت نشده است. برای مشاهده بارهای شهر خود، ابتدا شهر را در{" "}
                  <Link to="/account" className="font-bold underline">
                    حساب کاربری
                  </Link>{" "}
                  تکمیل کنید.
                </div>
              )}

              <form onSubmit={search} className="grid gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
                <label className="search-field">
                  <Search className="size-5 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <span className="block text-[11px] text-muted-foreground">جست‌وجوی بار</span>
                    <input
                      aria-label="جست‌وجوی محصول"
                      placeholder="نام محصول یا رقم…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="w-full min-w-0 bg-transparent py-1 text-sm outline-none"
                    />
                  </div>
                </label>
                <div className={`grid ${professionalOnly ? "grid-cols-3" : "grid-cols-4"} gap-1.5 sm:gap-2`}>
                  {!professionalOnly && (
                    <details className="relative min-w-0">
                      <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-0.5 rounded-lg border border-border bg-background px-1.5 py-1 text-[10px] font-semibold sm:px-2 sm:text-xs">
                        <span>
                          مقدار خرید{selectedSaleTypes.length && selectedSaleTypes.length < 3 ? ` (${selectedSaleTypes.length})` : ""}
                        </span>
                        <ChevronDown className="size-4 shrink-0" />
                      </summary>
                      <div className="absolute right-0 z-30 mt-2 w-52 rounded-xl border border-border bg-card p-3 shadow-xl">
                        <p className="mb-2 text-xs text-muted-foreground">یک یا چند گزینه را انتخاب کنید</p>
                        {[
                          { v: "retail", l: "خرده" },
                          { v: "wholesale", l: "عمده" },
                          { v: "special", l: "ویژه" },
                        ].map((opt) => (
                          <label
                            key={opt.v}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary"
                          >
                            <input
                              type="checkbox"
                              checked={selectedSaleTypes.includes(opt.v)}
                              onChange={(e) =>
                                setSelectedSaleTypes((prev) =>
                                  e.target.checked ? [...prev, opt.v] : prev.filter((v) => v !== opt.v),
                                )
                              }
                            />
                            {opt.l}
                          </label>
                        ))}
                        <button
                          type="button"
                          className="mt-2 text-xs font-semibold text-primary"
                          onClick={() => setSelectedSaleTypes(["retail", "wholesale", "special"])}
                        >
                          انتخاب همه
                        </button>
                      </div>
                    </details>
                  )}
                  <details className="relative min-w-0">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-0.5 rounded-lg border border-border bg-background px-1.5 py-1 text-[10px] font-semibold sm:px-2 sm:text-xs">
                      <span>محصول{selectedProducts.length ? ` (${selectedProducts.length})` : ""}</span>
                      <ChevronDown className="size-4 shrink-0" />
                    </summary>
                    <div className="absolute right-0 z-30 mt-2 max-h-64 w-60 overflow-auto rounded-xl border border-border bg-card p-3 shadow-xl">
                      <p className="mb-2 text-xs text-muted-foreground">امکان انتخاب چند محصول</p>
                      {availableProducts.map((product) => (
                        <label
                          key={product}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProducts.includes(product)}
                            onChange={(e) =>
                              setSelectedProducts((prev) =>
                                e.target.checked ? [...prev, product] : prev.filter((v) => v !== product),
                              )
                            }
                          />
                          {product}
                        </label>
                      ))}
                      {!availableProducts.length && (
                        <span className="text-xs text-muted-foreground">محصول فعالی موجود نیست</span>
                      )}
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-primary"
                        onClick={() => setSelectedProducts([])}
                      >
                        پاک‌کردن انتخاب محصول
                      </button>
                    </div>
                  </details>
                  <details className="relative">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-0.5 rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-semibold sm:text-xs">
                      <span>کیفیت{selectedQualities.length ? ` (${selectedQualities.length})` : ""}</span>
                      <ChevronDown className="size-4 shrink-0" />
                    </summary>
                    <div className="absolute right-0 z-30 mt-2 w-52 rounded-xl border border-border bg-card p-3 shadow-xl">
                      {qualities.map((q) => (
                        <label
                          key={q}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={selectedQualities.includes(q)}
                            onChange={(e) =>
                              setSelectedQualities((prev) =>
                                e.target.checked ? [...prev, q] : prev.filter((v) => v !== q),
                              )
                            }
                          />
                          {q}
                        </label>
                      ))}
                      <button
                        type="button"
                        className="mt-2 text-xs font-semibold text-primary"
                        onClick={() => setSelectedQualities([])}
                      >
                        همه کیفیت‌ها
                      </button>
                    </div>
                  </details>
                  <details className="relative">
                    <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-0.5 rounded-lg border border-border bg-card px-2 py-1 text-[10px] font-semibold sm:text-xs">
                      <span>قیمت</span>
                      <ChevronDown className="size-4 shrink-0" />
                    </summary>
                    <div className="absolute left-0 z-30 mt-2 w-60 rounded-xl border border-border bg-card p-3 shadow-xl">
                      <p className="mb-2 text-xs text-muted-foreground">بازه قیمت هر کیلو (تومان)</p>
                      <label className="mb-2 block text-xs">
                        از
                        <input
                          inputMode="numeric"
                          value={minPrice}
                          onChange={(e) => setMinPrice(normalizeNumericInput(e.target.value))}
                          className="field-input mt-1"
                          placeholder="حداقل قیمت"
                        />
                      </label>
                      <label className="block text-xs">
                        تا
                        <input
                          inputMode="numeric"
                          value={maxPrice}
                          onChange={(e) => setMaxPrice(normalizeNumericInput(e.target.value))}
                          className="field-input mt-1"
                          placeholder="حداکثر قیمت"
                        />
                      </label>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary"
                          onClick={() => setSort("price")}
                        >
                          ارزان به گران
                        </button>
                        <button
                          type="button"
                          className="text-xs font-semibold text-primary"
                          onClick={() => setSort("newest")}
                        >
                          جدیدترین
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    شهر:{" "}
                    {professionalOnly
                      ? "همه استان‌ها"
                      : !cityAccessReady
                        ? "در حال بررسی…"
                        : allowedCities.length > 1
                          ? allowedCities.join("، ")
                          : profileCity || "تکمیل نشده"}
                  </span>
                  <Button type="submit" className="h-8 px-3 text-[11px]">
                    <Search className="ml-1 size-3.5" />
                    اعمال
                  </Button>
                </div>
              </form>
              <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                <span className="ml-1">پرجست‌وجو:</span>
                {["پرتقال", "سیب", "گوجه‌فرنگی", "پیاز"].map((product) => (
                  <Button
                    key={product}
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setQuery(product);
                      setCity("");
                      setCategory("");
                      setQuality("");
                      setFilters({ city: "", category: "", quality: "", query: product });
                    }}
                  >
                    {product}
                  </Button>
                ))}
              </div>
            </div>
          </section>

          <section id="market-loads" className="scroll-mt-5 bg-market-surface py-5 sm:py-7">
            <div className="site-container">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-4">
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span aria-live="polite">{loadingLoads ? "در حال دریافت بارها…" : `${faNumber(filtered.length)} بار`}</span>
                  {(activeFilters(filters) ||
                    selectedSaleTypes.length !== 3 ||
                    selectedProducts.length > 0 ||
                    selectedQualities.length > 0 ||
                    minPrice ||
                    maxPrice) && (
                    <Button variant="ghost" className="h-7 px-2 text-xs" onClick={reset}>
                      <X className="size-3" />
                      حذف فیلترها
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <SlidersHorizontal className="size-3.5" />
                    <select
                      aria-label="مرتب‌سازی بارها"
                      className="max-w-36 bg-transparent text-foreground outline-none"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="newest">تازه‌ترین بارها</option>
                      <option value="price">کمترین قیمت</option>
                      <option value="stock">بیشترین موجودی</option>
                    </select>
                  </label>
                  {(cartItems.length > 0 || cartNotice) && (
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 gap-1 px-2 text-xs"
                      onClick={() => {
                        window.location.href = "/cart";
                      }}
                    >
                      <ShoppingCart className="size-3.5" />
                      سبد ({faNumber(cartItems.length)})
                    </Button>
                  )}
                </div>
              </div>

              {cartNotice && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-accent/50 px-3 py-2.5 text-sm">
                  <span className="font-semibold text-primary">
                    <PackageCheck className="ml-1 inline size-4" />
                    {cartNotice}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => {
                      window.location.href = "/cart";
                    }}
                  >
                    بررسی سبد خرید <ShoppingCart className="size-3.5" />
                  </Button>
                </div>
              )}

              {loadError && (
                <p role="alert" className="mt-4 text-sm text-destructive">
                  {loadError}
                </p>
              )}
              {cartError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {cartError}{" "}
                  <Link to="/cart" className="font-bold underline">
                    رفتن به سبد خرید
                  </Link>
                </p>
              )}

              {filtered.length ? (
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
                  {filtered.map((load) => (
                    <LoadCard
                      key={`${load.isSample ? "sample" : "live"}-${load.id}`}
                      load={load}
                      purchaseMode={activePurchaseMode}
                      cartSelected={cartItems.some((item) => String(item.load.id) === String(load.id))}
                      onAddToCart={addToCart}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <Search className="mx-auto mb-4 size-10 text-muted-foreground" />
                  <h3 className="text-lg font-bold">باری با این مشخصات پیدا نشد</h3>
                  <p className="mt-3 text-sm text-muted-foreground">
                    در این بخش، در حال حاضر بار فعالی با فیلترهای انتخاب‌شده پیدا نشد.
                  </p>
                  <Button variant="outline" className="mt-5" onClick={reset}>
                    حذف فیلترها
                  </Button>
                </div>
              )}
              <div className="mt-7 flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <PackageCheck className="size-4 text-primary" />
                {liveLoads.length ? "بارهای فعال و ثبت‌شده در بازار نمایش داده می‌شوند." : "تا زمان ثبت بار جدید، موارد پیشنهادی بازار قابل مشاهده است."}
              </div>
            </div>
          </section>
        </>
      )}

      {ordersOnly && (
        <>
          <section aria-label="درخواست سفارش و پیگیری" className="border-b border-border bg-market-surface py-5">
            <div className="site-container max-w-4xl">
              <h1 className="text-xl font-black">درخواست سفارش و پیگیری</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                از همین صفحه درخواست چندمحصولی ثبت کنید و وضعیت خریدها و درخواست‌های تأمین را دنبال کنید.
              </p>
              <Link
                to="/requests"
                className="mt-3 inline-flex items-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold"
              >
                بازگشت به بازار
              </Link>
            </div>
          </section>

          <section id="direct-order" className="scroll-mt-5 border-t border-border bg-card py-6 sm:py-8">
            <div className="site-container max-w-4xl">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                  <Send className="size-5" />
                </div>
                <div>
                  <h2 className="text-lg font-extrabold">درخواست سفارش چندمحصولی</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    محصولات موردنیاز را وارد کنید تا درخواست برای بررسی و تأمین ثبت شود.
                  </p>
                </div>
              </div>
              {orderSaved && (
                <div role="status" className="mb-4 rounded-lg border border-primary/20 bg-accent/40 p-3 text-sm font-semibold text-primary">
                  درخواست شما ثبت شد. از بخش «پیگیری سفارش» وضعیت آن را دنبال کنید.
                </div>
              )}
              {orderError && (
                <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {orderError}
                </p>
              )}
              <form onSubmit={submitDirectOrder} className="space-y-3 rounded-xl border border-border p-3 sm:p-4">
                {orderItems.map((item, index) => (
                  <div key={index} className="grid grid-cols-2 gap-2 rounded-lg bg-market-surface p-3 sm:grid-cols-5">
                    <label className="text-xs font-semibold">
                      نام محصول
                      <input
                        required
                        value={item.product}
                        onChange={(e) => updateItem(index, "product", e.target.value)}
                        className="field-input mt-1"
                        placeholder="مثلاً سیب"
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      رقم / توضیح
                      <input
                        value={item.variety}
                        onChange={(e) => updateItem(index, "variety", e.target.value)}
                        className="field-input mt-1"
                        placeholder="اختیاری"
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      مقدار موردنیاز
                      <input
                        required
                        inputMode="decimal"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", normalizeNumericInput(e.target.value))}
                        className="field-input mt-1"
                        placeholder="مقدار"
                      />
                    </label>
                    <label className="text-xs font-semibold">
                      واحد
                      <select
                        value={item.unit}
                        onChange={(e) => updateItem(index, "unit", e.target.value)}
                        className="field-input mt-1"
                      >
                        <option value="kg">کیلوگرم</option>
                        <option value="package">بسته</option>
                        <option value="ton">تن</option>
                      </select>
                    </label>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full text-xs"
                        disabled={orderItems.length === 1}
                        onClick={() => setOrderItems((items) => items.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="ml-1 size-3.5" />
                        حذف ردیف
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 text-xs"
                    onClick={() => setOrderItems((items) => [...items, emptyItem()])}
                  >
                    <Plus className="ml-1 size-4" />
                    افزودن محصول
                  </Button>
                  <label className="min-w-40 flex-1 text-xs font-semibold">
                    تاریخ موردنیاز (هجری شمسی، اختیاری)
                    <input
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={neededBy}
                      onChange={(e) => {
                        setNeededBy(normalizeDigits(e.target.value));
                        setNeededByError("");
                      }}
                      className="field-input mt-1 text-left"
                      placeholder="۱۴۰۵/۰۷/۲۹"
                      aria-describedby="needed-by-help"
                    />
                    <span id="needed-by-help" className="mt-1 block text-[11px] text-muted-foreground">
                      عدد فارسی یا انگلیسی؛ نمونه: ۱۴۰۵/۰۷/۲۹ یا 1405/07/29
                    </span>
                    {neededByError && (
                      <span role="alert" className="mt-1 block text-[11px] text-destructive">
                        {neededByError}
                      </span>
                    )}
                  </label>
                </div>
                <label className="block text-xs font-semibold">
                  توضیحات تکمیلی
                  <textarea
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    className="field-input mt-1 min-h-20"
                    placeholder="کیفیت یا شرایط موردنظر (اختیاری)"
                  />
                </label>
                <Button type="submit" disabled={orderBusy} className="h-10 w-full sm:w-auto">
                  {orderBusy ? "در حال ثبت…" : "ثبت درخواست سفارش"}
                </Button>
              </form>
            </div>
          </section>

          <section id="tracking" className="scroll-mt-5 border-t border-border bg-market-surface py-6 sm:py-8">
            <div className="site-container max-w-4xl">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                    <PackageCheck className="size-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-extrabold">پیگیری خرید و سفارش</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      وضعیت سفارش‌های ثبت‌شده و درخواست‌های تأمین را ببینید یا خرید را ادامه دهید.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    to="/cart"
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground"
                  >
                    <ShoppingCart className="size-4" />
                    ادامه خرید / سبد
                  </Link>
                  <Link
                    to="/requests"
                    className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-card px-3 text-xs font-semibold"
                  >
                    بازگشت به بازار
                  </Link>
                </div>
              </div>

              {myRequestError && (
                <p role="alert" className="mb-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                  {myRequestError}
                </p>
              )}

              {loadingMyRequests ? (
                <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                  در حال دریافت سفارش‌ها…
                </p>
              ) : (
                <>
                  <h3 className="mb-2 font-bold">خریدهای ثبت‌شده</h3>
                  {myOrders.length ? (
                    <div className="mb-5 space-y-2">
                      {myOrders.map((order) => (
                        <article key={order.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-bold">فاکتور شماره {faNumber(order.invoice_number)}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {new Date(order.created_at).toLocaleDateString("fa-IR")} · {faNumber(order.quantity)}{" "}
                                {order.unit === "package" ? "بسته" : order.unit}
                              </p>
                            </div>
                            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-primary">
                              {orderStatusLabels[order.status] || order.status || "در حال بررسی"}
                            </span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>پرداخت: {paymentStatusLabels[order.payment_status] || order.payment_status || "نامشخص"}</span>
                            {order.total_price != null && <span>مبلغ: {faNumber(order.total_price)} تومان</span>}
                            {order.delivery_status && (
                              <span>تحویل: {deliveryStatusLabels[order.delivery_status] || order.delivery_status}</span>
                            )}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {order.delivery_status === "shipped" && (
                              <Button
                                type="button"
                                size="sm"
                                className="h-8 gap-1 text-xs"
                                disabled={orderActionBusyId === order.id}
                                onClick={() => void confirmOrderDelivered(order.id)}
                              >
                                <CheckCircle2 className="size-3.5" />
                                {orderActionBusyId === order.id ? "در حال ثبت…" : "تأیید تحویل کالا"}
                              </Button>
                            )}
                            <Link
                              to="/cart"
                              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-semibold"
                            >
                              سبد خرید
                            </Link>
                            <Link
                              to="/requests"
                              className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-xs font-semibold"
                            >
                              انتخاب محصول دیگر
                            </Link>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="mb-5 rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                      هنوز خریدی ثبت نکرده‌اید. از بازار محصول انتخاب کنید و به سبد خرید بروید.
                    </p>
                  )}

                  <h3 className="mb-2 font-bold">درخواست‌های تأمین چندمحصولی</h3>
                  {myDirectRequests.length ? (
                    <div className="space-y-2">
                      {myDirectRequests.map((request) => (
                        <article key={request.id} className="rounded-xl border border-border bg-card p-3 sm:p-4">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-bold">
                                درخواست شماره {faNumber(request.request_number)} · {request.product_type} ·{" "}
                                {faNumber(request.quantity)}{" "}
                                {request.quantity_unit === "kg" ? "کیلوگرم" : request.quantity_unit === "ton" ? "تن" : "بسته"}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {new Date(request.created_at).toLocaleDateString("fa-IR")}
                                {request.quality_requirements ? ` · ${request.quality_requirements}` : ""}
                              </p>
                            </div>
                            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-primary">
                              {directStatusLabels[request.status] || request.status}
                            </span>
                          </div>
                          {request.notes && <p className="mt-2 text-xs text-muted-foreground">{request.notes}</p>}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-border bg-card p-4 text-sm text-muted-foreground">
                      درخواستی برای تأمین ثبت نشده است.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}

export function OrdersPage() {
  return <Requests ordersOnly />;
}

function activeFilters(filters: { city: string; category: string; quality: string; query: string }) {
  return Object.values(filters).some(Boolean);
}
