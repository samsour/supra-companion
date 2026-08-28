# Supra Companion

Road-trip companion for the Supra community: live convoy map, shared route, driving
stats — NFS Underground style. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the plan.

```
apps/web        Vite + React PWA (the week-one app)
packages/core   Pure TS domain logic — gap engine, stats, realtime protocol
supabase/       SQL migrations (schema, RLS, RPCs, realtime auth)
```

## Setup (once)

1. **Supabase**: create a project at supabase.com, then:
   - Dashboard → Authentication → Sign In / Up → enable **Anonymous sign-ins**.
   - Dashboard → SQL Editor → run `supabase/migrations/0001_init.sql`.
2. **Mapbox**: create an account, grab a public access token (Day 2+).
3. **Env**: `cp apps/web/.env.example apps/web/.env` and fill in the values
   (Supabase Project Settings → API).
4. `pnpm install`

## Develop

```sh
pnpm dev          # start the web app (http://localhost:5173)
pnpm test         # core unit tests (gap engine, stats filters)
pnpm typecheck
pnpm build
```

Geolocation and Wake Lock require HTTPS or localhost. To test on a phone against
your dev machine, use `pnpm --filter @supra/web dev --host` and open the LAN URL —
for GPS on iOS you'll need an HTTPS tunnel (e.g. `cloudflared tunnel` or ngrok) or a
deployed preview.

## Rules of the repo

- `packages/core` must stay pure TypeScript: **no React, no DOM, no browser APIs.**
  It is imported unchanged by the Phase-2 React Native app.
- Don't put secrets in `VITE_*` vars beyond the Supabase anon key and Mapbox public
  token (both are designed to be public; security lives in RLS).
