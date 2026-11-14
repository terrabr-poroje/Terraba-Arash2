export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <title>خطا در بارگذاری صفحه | ترابار</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.7 -apple-system, BlinkMacSystemFont, Tahoma, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; direction: rtl; text-align: center; }
      .card { max-width: 28rem; width: 100%; background: #fff; border: 1px solid #e5e7eb; border-radius: 1rem; padding: 2rem; box-shadow: 0 4px 20px rgba(0,0,0,0.04); }
      h1 { font-size: 1.25rem; margin: 0 0 0.75rem; color: #1c382b; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.6rem 1.25rem; border-radius: 0.5rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #1e704b; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>بارگذاری صفحه با خطا مواجه شد</h1>
      <p>مشکلی در پردازش درخواست در سمت سرور پیش آمد. لطفاً صفحه را تازه کنید یا به صفحه اصلی بازگردید.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">تلاش مجدد</button>
        <a class="secondary" href="/">بازگشت به بازار</a>
      </div>
    </div>
  </body>
</html>`;
}
