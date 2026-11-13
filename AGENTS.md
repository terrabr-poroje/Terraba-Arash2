<!-- TERRABAR:BEGIN -->
> [!IMPORTANT]
> The project's backend runs on **Cloudflare D1 / SQLite** (`.d1-local.sqlite` in development),
> with **sms.ir** for SMS OTP and event notifications, **Resend** for email OTP/alerts,
> and **ParsPack S3** for image storage.
>
> All API endpoints live under `/api/*` via the shared `src/lib/api-router.ts` router,
> mounted by `src/server.ts` and Vite's dev middleware (`vite.config.ts`).
> Supabase has been permanently removed from this project.
<!-- TERRABAR:END -->

- Stage-one marketplace data and package calculations live in `src/lib/marketplace.ts`, with no backend imports, so preview calculations stay safe.
- Shared marketplace navigation surrounds the root Outlet; shareable information pages use separate leaf routes with their own metadata.
- Role-based access control (RBAC), ownership verification, rate limiting, and audit logs are enforced server-side in `src/lib/api-router.ts` and `src/lib/d1-database.ts`.
