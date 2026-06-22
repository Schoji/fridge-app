# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # start dev server
npm run build    # production build (requires .env.local with real Supabase credentials)
npm run start    # start production server after build
npx tsc --noEmit # type-check without building
```

No linter or test suite is configured.

## Architecture

Mobile-first PWA built with **Next.js 16** (Turbopack, App Router), **Tailwind CSS v4**, and **Supabase** (auth + PostgreSQL + Storage).

### Next.js 16 specifics (differs from prior versions)

- Route protection lives in `src/proxy.ts` — this is the Next.js 16 replacement for `middleware.ts`. It exports `proxy` (not `middleware`) and uses the same `config.matcher` export.
- Tailwind v4 is configured via `postcss.config.mjs` only — there is no `tailwind.config.js`. Custom tokens go in `globals.css` under `@theme`.

### Supabase integration

Two client factories:
- `src/lib/supabase-client.ts` — `createBrowserClient` for use inside client components (event handlers and `useEffect` only, **never at module/render level** — SSR pre-render will throw without real env vars)
- `src/lib/supabase-server.ts` — `createServerClient` with cookie store for Server Components and the proxy

Auth is email/password via Supabase Auth. All pages are `'use client'` and publicly pre-rendered as static shells; data is fetched client-side after hydration.

### Data flow

`src/proxy.ts` runs on every request, refreshes the Supabase session cookie, and redirects unauthenticated users to `/login`. The three app routes are:

| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Product list, sorted by `expiration_date ASC` |
| `/add` | `src/app/add/page.tsx` | Add product form with optional image upload |
| `/login` | `src/app/login/page.tsx` | Shared-account sign-in |

### Image uploads

`/add` compresses images client-side via `browser-image-compression` (max 0.5 MB / 1200 px) before uploading to the `product-images` Supabase Storage bucket. The full public URL is stored in `products.image_url`. Deletion removes both the DB row and the storage object (path extracted by splitting on `/product-images/`).

### Expiry color logic

Computed from `expiration_date` in `src/app/page.tsx`:
- **Red** — past today
- **Orange** — 0–3 days from today
- **No accent** — 4+ days away

### Required Supabase setup

```sql
CREATE TABLE products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  expiration_date date NOT NULL,
  image_url text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON products
  FOR ALL USING (auth.role() = 'authenticated');
```

Storage: one **public** bucket named `product-images`.

Environment variables (copy `.env.local.example` → `.env.local`):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-only, for /api/fridge-status
HERMES_API_TOKEN=            # bearer token Hermes must send
```

## Hermes integration (`/api/fridge-status`)

Read-only JSON endpoint so the [Hermes Agent](https://hermes-agent.nousresearch.com)
(or a cron job) can poll fridge state and push expiry notifications over its own
channels (Telegram/Slack/etc.).

- `src/app/api/fridge-status/route.ts` — `GET` route handler. Auth via
  `Authorization: Bearer $HERMES_API_TOKEN`. Optional `?within=N` overrides the
  3-day "expiring soon" horizon.
- `src/lib/supabase-admin.ts` — service-role client (bypasses RLS, no user
  session). **Server-only**; never import into a client component.
- `src/proxy.ts` matcher excludes `api` so the unauthenticated endpoint isn't
  redirected to `/login`.
- Day counts are anchored to `Europe/Warsaw` to match the browser-local UI.

Response shape: `{ generated_at, summary{total,expired,expiring_soon,fresh,within_days}, expired[], expiring_soon[], message }`.
`message` is a ready-to-send Polish summary Hermes can forward verbatim.

```bash
curl -H "Authorization: Bearer $HERMES_API_TOKEN" https://<host>/api/fridge-status
```
