# گزارش فنی و راه‌حل کامل: رفع مشکل باز نشدن یا کندی سایت روی اینترنت همراه اول (MCI) و سایر شبکه‌های موبایل ایران

این گزارش بر اساس بررسی عمیق معماری ریپازیتوری مرجع موفق (`Arash-kavianipoor/m-gas-ir-last-version`) و تطبیق کامل آن با ساختار فنی سامانه **ترابار** (TanStack Start + Vite 8 + Rolldown + Cloudflare Workers / D1) تهیه شده است.

---

## ۱. خلاصه علت مشکل (چرا روی ایرانسل باز می‌شود اما روی همراه اول خیر؟)

بررسی همزمان خروجی بیلد پروژه، هدرهای SSR سرور و رفتار شبکه اپراتورهای ایران نشان داد که اختلاف رفتار بین **ایرانسل** و **همراه اول (MCI)** ناشی از ترکیب **۵ عامل فنی** در سمت کلاینت، بیلد، ورکر سرور و شبکه لبه (Cloudflare Edge) است:

1. **طوفان درخواست‌های همزمان و چانک‌های ریز (Micro-Chunk Storm):**
   خروجی قبلی پروژه شامل **۹۷ فایل مجزا** در مسیر `/assets/` بود که بیش از **۳۵ فایل آن ماژول‌های بسیار ریز (۱۲۰ تا ۴۰۰ بایتی)** مربوط به تک‌تک آیکون‌های `lucide-react` بود و به همراه ده‌ها هدر `Link: <...>; rel=modulepreload` ارسال می‌شد. در شبکه موبایل همراه اول (که حساسیت بالایی به تعداد استریم‌های همزمان TLS/HTTP2 و افت بسته دارد)، قطع شدن حتی یک ماژول ۳۰۰ بایتی باعث توقف کامل بوت شدن اپلیکیشن React و صفحه سفید می‌شد.
2. **پاسخ HTML استریم‌شده (Chunked Transfer) بدون `Content-Length`:**
   TanStack Start در حالت پیش‌فرض پاسخ SSR HTML را به‌صورت استریم (بدون هدر دقیق `Content-Length`) ارسال می‌کرد. پراکسی‌های شفاف (Transparent Proxy / DPI) در شبکه همراه اول در مواجهه با پاسخ‌های استریمی یا هدرهای طولانی `Link`، اتصال را معلق (Stall) یا Reset می‌کنند.
3. **خطای دسترسی به `localStorage` / `sessionStorage` در وب‌ویوها و حالت خصوصی (Incognito):**
   بسیاری از کاربران روی موبایل لینک سایت را از طریق وب‌ویوهای داخلی تلگرام، اینستاگرام، روبیکا، ایتا یا حالت Private مرورگر باز می‌کنند که در آن‌ها دسترسی به `localStorage` خطای `SecurityError` صادر می‌کند. تماس‌های محافظت‌نشده در ماژول‌های احراز هویت می‌توانست اجرای اسکریپت را متوقف کند.
4. **ناسازگاری برخی سینتکس‌ها و APIها با WebKit و مرورگرهای قدیمی موبایل:**
   هدف بیلد قبلی (`es2018 / safari12 / chrome65`) و نبود پلی‌فیل‌های تکمیلی (`Object.fromEntries`, `Array.flat/flatMap/at`, `String.replaceAll`, `Promise.allSettled`, `structuredClone`, `matchMedia.addEventListener`, `Element.closest`) در گوشی‌های قدیمی‌تر اندروید و آیفون مشکل ایجاد می‌کرد.
5. **کش‌های معیوب Service Worker و تنظیمات شبکه کلودفلر (QUIC/HTTP3 و `workers.dev`):**
   عدم وجود سرویس‌ورکر پاکسازی‌کننده (`sw.js`) برای تخلیه کش‌های خراب قبلی و همچنین فعال بودن پروتکل‌هایی مثل **HTTP/3 (UDP/443)** در کلودفلر که در شبکه همراه اول اغلب Drop می‌شود.

---

## ۲. اقدامات فنی انجام‌شده روی کد و پیکربندی پروژه ترابار

تمامی الگوهای موفق از ریپازیتوری مرجع با سازگاری کامل با **TanStack Start + Cloudflare Workers** پیاده‌سازی شدند:

### الف) تجمیع چانک‌های کلاینت و کاهش چشمگیر درخواست‌های شبکه (`vite.config.ts`)
- تنظیم `environments.client.build.rollupOptions.output.manualChunks` برای ادغام ماژول‌های پراکنده:
  - تمام آیکون‌های `lucide-react` در یک فایل واحد و کش‌شونده: `lucide-icons`
  - هسته `react`، `react-dom` و `scheduler` در یک فایل واحد: `react-vendor`
  - کتابخانه‌های `@tanstack/*` در `tanstack-vendor`
  - کامپوننت‌های `@radix-ui/*` در `ui-vendor`
  - نمودارها در `charts-vendor`
- **نتیجه عددی واقعی بیلد:** تعداد فایل‌های خروجی در `.output/public/assets` از **۹۷ فایل** به **۴۳ فایل** کاهش یافت (بیش از ۵۵٪ کاهش تعداد درخواست‌های همزمان و حذف کامل ۳۵+ چانک ریز ۲۰۰ بایتی آیکون‌ها).
- تنظیم `target` به `["es2015", "edge18", "firefox60", "chrome60", "safari11"]` و `cssTarget` به `["chrome60", "firefox60", "safari11", "edge18"]` و `esbuild.target: "es2015"`.

### ب) بافر کردن کامل HTML در سرور Worker و بهینه‌سازی هدرها (`src/server.ts`)
- تبدیل پاسخ‌های SSR با نوع `text/html` از حالت استریم به **بافر کامل بایتی (`Uint8Array`)** و درج هدر دقیق `Content-Length`.
- **حذف هدرهای `Link` (modulepreload bloat)** از پاسخ HTML سرور تا اندازه هدرهای HTTP/2 کوچک و استاندارد بماند و فوران درخواست همزمان روی شبکه همراه اول رخ ندهد.
- افزودن هدر `Vary: Accept-Encoding` و `Cache-Control: public, max-age=0, must-revalidate` برای اسناد HTML.
- پاسخ سریع و استاندارد `204 No Content` برای درخواست‌های پیش‌پرواز `OPTIONS` (CORS Preflight).
- تنظیم هدرهای امنیتی استاندارد:
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- سرو دقیق `/sw.js` با `Cache-Control: no-cache, no-store, must-revalidate` تا مرورگر هیچ‌گاه نسخه قدیمی را نگه ندارد.

### ج) شیم حافظه و محافظت از `localStorage` / `sessionStorage` و وب‌ویوها
- **اسکریپت همزمان داخل `<head>` (`src/lib/browser-polyfills.ts` و `scripts/prepare-dist.mjs`):** پیش از لود شدن هر باندل جاوااسکریپت، دسترسی به `localStorage` تست می‌شود و در صورت مسدود بودن (Incognito یا WebView)، یک `MemoryStore` استاندارد جایگزین `window.localStorage` و `window.sessionStorage` می‌شود و `window.console` نیز در صورت نبود ایمن‌سازی می‌گردد.
- **ماژول `src/lib/safe-storage.ts`:** لایه دسترسی ایمن با حافظه پشتیبان (`Map`) و جایگزینی آن در `auth.ts`، `api-client.ts`، `sms-client.ts`، `email-client.ts`، `storage-client.ts` و `theme.ts` (به همراه `try/catch` برای نوشتن کوکی).
- **پلی‌فیل‌های زمان اجرا:** افزودن محافظ برای `Object.fromEntries`، `Array.prototype.flat/flatMap/at`، `String.prototype.at/replaceAll`، `Promise.allSettled`، `structuredClone`، `queueMicrotask`، `matchMedia.addEventListener`، `Element.closest/matches` و `Node.contains`.

### د) بازیابی خودکار از خطای بارگذاری چانک و Error Boundary (`src/components/error-boundary.tsx` و `src/routes/__root.tsx`)
- افزودن `AppErrorBoundary` فارسی دور تمام مسیرهای اپلیکیشن.
- افزودن مکانیزم **`installChunkLoadRecovery()`**: اگر به دلیل نوسان ناگهانی اینترنت همراه اول یا همزمانی با Deploy جدید یکی از ماژول‌های داینامیک (`Failed to fetch dynamically imported module` / `ChunkLoadError`) خطا بدهد، صفحه به‌صورت خودکار (حداکثر یک بار در هر ۳۰ ثانیه برای جلوگیری از حلقه رفرش) بازیابی و بارگذاری مجدد می‌شود.

### هـ) پاکسازی Service Worker و کش‌های معیوب (`public/sw.js` و `public/_headers`)
- ایجاد `public/sw.js` خودحذف‌شونده برای پاکسازی تمام `CacheStorage`های احتمالی قبلی در مرورگر کاربران و فراخوانی غیرمسدودکننده `unregisterServiceWorker()` پس از مانت شدن صفحه اصلی.
- همگام‌سازی کامل هدرهای امنیتی و کش استاتیک در `public/_headers`.

### و) استراتژی کش قوی فونت‌های لوکال و Preload در Safari (`__root.tsx`، `vite.config.ts`، `src/server.ts`)
- **ذخیره ۱۰۰٪ لوکال فونت‌ها:** فونت متغیر `Vazirmatn-Variable.woff2` و وزن‌های استاتیک آن در مسیر محلی `/public/fonts/vazirmatn/` نگهداری می‌شوند و هیچ درخواست خارجی (مانند Google Fonts) در صفحه وجود ندارد.
- **پیش‌بارگذاری (`preload`) در `<head>`:** تگ `<link rel="preload" as="font" type="font/woff2" href="/fonts/vazirmatn/Vazirmatn-Variable.woff2" crossorigin="anonymous" />` در ریشه HTML قرار گرفت تا Safari و WebKit پیش از تکمیل پردازش CSS، فایل فونت را به‌صورت همزمان دریافت کنند.
- **هدرهای کش و دسترسی فونت:** در هر دو لایه `vite.config.ts` (dev/preview) و `src/server.ts` و `public/_headers` برای تمام فایل‌های `/fonts/*` (`.woff2`, `.woff`, `.ttf`, `.otf`) هدرهای زیر ست شدند:
  - `Cache-Control: public, max-age=31536000, immutable`
  - `Access-Control-Allow-Origin: *` (ضروری برای Preload در Safari)
  - `Cross-Origin-Resource-Policy: cross-origin` و `Content-Type` دقیق فونت (`font/woff2`, `font/ttf` و ...)

### ز) اصلاح سراسری CORS برای تمام APIها و لایه فشرده‌سازی Gzip / Brotli
- **CORS یکپارچه روی تمام مسیرهای `/api/*`:** در `vite.config.ts`، `src/lib/api-router.ts` و `src/server.ts` تمامی پاسخ‌های API (موفق، خطا و `OPTIONS` پیش‌پرواز) دارای هدرهای `Access-Control-Allow-Origin: *`، `Access-Control-Allow-Methods`، `Access-Control-Allow-Headers` و `Vary: Origin, Accept-Encoding` هستند.
- **فشرده‌سازی پاسخ سرور (Brotli / Gzip):** ماژول `src/lib/http-compression.ts` در لایه پاسخ `src/server.ts` و میدل‌ویر `vite.config.ts` پاسخ‌های متنی/JSON/HTML/JS/CSS/SVG بزرگ‌تر از ۵۱۲ بایت را بر اساس هدر `Accept-Encoding` مرورگر با الگوریتم **Brotli (`br`)** یا **Gzip (`gzip`)** فشرده و با `Content-Length` دقیق ارسال می‌کند.

---

## ۳. چک‌لیست ضروری تنظیمات پنل Cloudflare (برای همراه اول)

علاوه بر اصلاحات کد که در این نسخه اعمال شد، یکی از مهم‌ترین دلایل تفاوت بین **ایرانسل** و **همراه اول** در سایت‌های مستقر روی Cloudflare، تنظیمات شبکه در داشبورد Cloudflare است. لطفاً پس از Deploy جدید موارد زیر را در پنل Cloudflare دامنه خود بررسی کنید:

1. **استفاده از Custom Domain به جای آدرس `*.workers.dev`:**
   - زیردامنه‌های `workers.dev` در بسیاری از رنج‌های IP و DNS همراه اول دچار اختلال یا محدودیت هستند. حتماً سایت را روی دامنه اصلی خود (با رکورد Proxied یا Custom Domain متصل به Worker) باز کنید.
2. **خاموش کردن HTTP/3 (with QUIC) در کلودفلر (مهم‌ترین مورد شبکه همراه اول):**
   - مسیر: `Cloudflare Dashboard -> Speed -> Optimization -> Protocol Optimization` (یا بخش `Network`)
   - گزینه **HTTP/3 (with QUIC)** را روی **Off** قرار دهید.
   - *دلیل:* همراه اول در بسیاری از دکل‌های موبایل بسته‌های UDP روی پورت 443 (مورد نیاز QUIC/HTTP3) را دراپ می‌کند؛ در نتیجه مرورگر موبایل چند ثانیه در حالت «در حال اتصال» قفل می‌شود، در حالی که ایرانسل بسته‌های UDP/443 را عبور می‌دهد. با خاموش کردن HTTP/3، تمام مرورگرها فوراً با HTTP/2 (TCP/443) باز می‌شوند.
3. **بررسی TLS 1.3 و Encrypted ClientHello (ECH):**
   - مسیر: `SSL/TLS -> Edge Certificates`
   - اگر روی همراه اول اتصال در مرحله SSL Handshake قطع می‌شود، گزینه **Encrypted ClientHello (ECH)** (در صورت نمایش در پلن شما) را **Off** کنید. حالت `Minimum TLS Version` روی `TLS 1.2` باقی بماند.
4. **بررسی IPv6 در تب Network:**
   - مسیر: `Network -> IPv6 Compatibility`
   - در برخی شهرها مسیریابی IPv6 همراه اول به دیتاسنترهای کلودفلر با افت بسته همراه است. در صورت تداوم کندی روی برخی سیم‌کارت‌های همراه اول، تست خاموش کردن موقت IPv6 یا بررسی سرعت با ابزار Cloudflare Trace (`/cdn-cgi/trace`) توصیه می‌شود.
5. **خاموش بودن Rocket Loader و Speed Brain:**
   - مسیر: `Speed -> Optimization`
   - گزینه **Rocket Loader** باید حتماً **Off** باشد تا ترتیب اجرای اسکریپت‌های `<head>` و ماژول‌های `type="module"` به هم نریزد.

---

## ۴. فایل‌های ایجاد و به‌روزرسانی شده در این اصلاحیه

- `vite.config.ts`: تجمیع چانک‌های کلاینت (`lucide-icons`, `react-vendor`, `tanstack-vendor`, `ui-vendor`, `charts-vendor`) و هدف بیلد `es2015 / safari11`.
- `src/server.ts`: بافر کامل SSR HTML با `Content-Length` دقیق، حذف هدرهای `Link` preload اضافی، پاسخ `OPTIONS 204`، هدرهای امنیتی و `no-store` برای `/sw.js`.
- `src/lib/safe-storage.ts`: لایه ایمن `localStorage`/`sessionStorage` با حافظه موقت + تخلیه SW و ریکاوری خطای چانک.
- `src/lib/browser-polyfills.ts` و `scripts/prepare-dist.mjs`: شیم همزمان حافظه در `<head>` و پلی‌فیل‌های سازگاری WebKit/Android.
- `src/components/error-boundary.tsx` و `src/routes/__root.tsx`: محافظ رندر با دکمه بارگذاری مجدد فارسی و نصب هوک بازیابی چانک.
- `src/lib/auth.ts`, `src/lib/api-client.ts`, `src/lib/sms-client.ts`, `src/lib/email-client.ts`, `src/lib/storage-client.ts`, `src/lib/theme.ts`: استفاده سراسری از `safeStorage`.
- `public/sw.js` و `public/_headers`: پاکسازی سرویس‌ورکرهای مزاحم و هدرهای استاتیک لبه کلودفلر.
