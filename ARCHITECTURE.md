# Supra Companion — Architecture Plan (v2: one-week web MVP)

A road-trip companion for the Toyota Supra community. Live convoy map, shared route,
driving stats (km driven, gap to the car ahead/behind), styled after Need for Speed
Underground.

**v2 scope change:** the first trip is ~1 week out, so the MVP ships as a **web app**
(a URL in the group chat — zero installs, zero store review, works on every phone).
CarPlay and native apps move to Phase 2; the architecture below is deliberately
structured so that migration is cheap. v1 of this doc (native RN + CarPlay) is
preserved in git history and its decisions still apply to Phase 2.

---

## 1. What a week kills — and what it doesn't

- **CarPlay: impossible this week, period.** Apple's CarPlay navigation entitlement
  takes 2–6 weeks to be granted. **→ Apply for it now anyway** (it's free and runs in
  parallel) so Phase 2 isn't blocked later.
- **App Store / Play Store: out.** No review cycles, no signing pipelines.
- **Native apps: out** — not because RN can't be done in a week, but because a web app
  takes ~3–4 days and leaves buffer for real-drive testing, which matters more.
- **Navigation:** drivers run **Apple Maps on CarPlay** for turn-by-turn (Android
  drivers: Google Maps). The phone — mounted or in the cubby — runs the convoy app
  alongside it. The app shows the shared route line and next-checkpoint info, but does
  not do turn-by-turn this week.
- **Not killed:** live convoy map, P1/P2 ordering with time gaps, km/stats, the NFS
  Underground look, checkpoints. The soul of the app survives the cut.

## 2. Will the web version dead-end us before CarPlay? (No — if we do this)

CarPlay requires a native iOS app; no web technology reaches the head unit. "Adding
CarPlay later" therefore means building the Phase-2 React Native app from v1 of this
plan. What carries over from the week-one build:

| Layer | Carries over? | Notes |
|---|---|---|
| Supabase backend (schema, RLS, Realtime channels, Edge Functions) | **100%** | The native app talks to the exact same backend. Web and native clients can even share one live trip. |
| Domain logic: gap engine, route snapping, stats math, realtime protocol, types | **100%** | **The load-bearing rule:** all of it lives in `packages/core` — pure TypeScript, no DOM, no React. React Native runs TypeScript; the future app imports the package unchanged. |
| React UI (screens, components) | Partially | Hooks/state logic ports; JSX must be rewritten against RN primitives (`View`/`Text` instead of `div`). Screens are the cheap part. |
| Map rendering | Rewrite | Mapbox GL JS (web) vs `@rnmapbox/maps` (native) are different APIs — but the **custom neon style is one Mapbox Studio asset shared by both**, and by CarPlay too. |
| CarPlay scene | New (Swift) | Was always going to be native regardless of stack. Mapbox Navigation SDK's `CarPlayManager` does the heavy lifting. |

**Estimated Phase-2 cost:** ~2–3 additional weeks for the RN app + CarPlay, not a
restart — plus the entitlement wait, which is why the application goes in now. The web
app doesn't die at Phase 2 either: it stays as the no-install fallback and the way
passengers/friends without the app watch the convoy.

**The one discipline that makes this true:** nothing in `packages/core` may import
React, the DOM, or browser APIs. Geolocation, wake lock, and rendering stay in
`apps/web`; core gets fed plain data.

---

## 3. Week-one stack

| Concern | Decision | Why |
|---|---|---|
| Frontend | **React + TypeScript + Vite**, installable PWA (manifest + add-to-homescreen) | You write React; no SSR needed for a live map SPA. Standalone PWA mode gives fullscreen NFS UI without browser chrome. |
| Map | **Mapbox GL JS** + custom Studio neon style | Same style asset later themes native and CarPlay. Directions API for the organizer's route. |
| Backend | **Supabase**: Postgres + RLS, Realtime broadcast/presence, anonymous auth, one Edge Function | Unchanged from v1 — this is the part that permanently carries over. |
| Auth | **Supabase anonymous sign-in** + chosen handle + trip invite code | No accounts, no OAuth setup, no email flows. A driver is "handle + car" scoped to a trip. Upgradeable to real auth in Phase 2 without schema surgery (the `auth_id` column is already there). |
| Hosting | Vercel (or Cloudflare Pages) | Push-to-deploy; HTTPS by default (required for geolocation + wake lock). |

## 4. System overview

```
┌──────────────── Web app (React + Vite PWA) — every phone, via URL ────────────────┐
│  join via invite code · convoy map · drive mode · route + checkpoints · stats      │
│  Mapbox GL JS (neon style) · watchPosition loop · Wake Lock · realtime client      │
│  imports ─────────────► packages/core (gap engine, stats, protocol — pure TS)      │
└──────────────┬────────────────────────────────────────────┬───────────────────────┘
               │ WebSocket (Realtime)                       │ HTTPS
               ▼                                            ▼
┌──────────────── Supabase ────────────────┐   ┌───────── Mapbox ─────────┐
│ Realtime: trip:{id} broadcast + presence  │   │ Studio style (neon)      │
│ Postgres + RLS: trips, members, samples   │   │ Directions API           │
│ Anonymous auth · Edge Fn: trip stats      │   └──────────────────────────┘
└───────────────────────────────────────────┘
   Turn-by-turn this week: Apple Maps on CarPlay / Google Maps, running alongside.
```

## 5. Core features (unchanged mechanics, web constraints noted)

### Live convoy map
- Client publishes `{lat, lng, speed, heading, accuracy, ts}` from
  `navigator.geolocation.watchPosition` (high accuracy) to Realtime broadcast channel
  `trip:{trip_id}`, throttled to every 3–5 s moving / 30 s stationary.
- Batch-insert samples to `location_samples` every ~30 s for stats. Presence for
  online status; dropped members show "last seen" at their final position.
- Dead-reckon between pings so cars glide, not teleport.
- **Web constraint — the big one:** browsers stop geolocation when the tab is
  backgrounded or the screen locks. Mitigations: **Wake Lock API** (screen stays on
  while in Drive Mode; supported in iOS Safari 16.4+ and Android Chrome), a loud
  re-acquire banner when visibility returns, and the social fix — on a convoy drive
  the phone is mounted and displaying the app anyway. Set expectations in the UI:
  "keep me on screen while driving."

### Route & checkpoints
- Organizer builds the route (start → checkpoints → destination) with Mapbox
  Directions in a simple editor; geometry stored on the trip as GeoJSON.
- Everyone sees the same neon route line + checkpoint markers (fuel/food/photo/meet)
  and "next checkpoint in 34 km". Turn-by-turn stays in Apple/Google Maps this week.

### Convoy positions & gaps (the NFS bit) — lives in `packages/core`
1. Snap each member's position onto the route polyline → cumulative distance along
   route.
2. Sort → P1, P2, P3…
3. Gap ahead = Δ route-distance; time gap = Δ distance ÷ your current speed (fallback:
   convoy rolling average when stopped).
4. > ~250 m off the line → "off route", excluded from ordering until rejoin.
- Pure functions over plain data. This module is the heart of the app and ships to
  Phase 2 untouched.

### Stats
- Live client-side: trip km (Haversine sum, filtered: drop accuracy > 30 m or implied
  speed > 250 km/h), moving time, current/avg speed, position, gaps.
- On trip end, one Edge Function aggregates samples → `trip_stats` → post-trip
  results screen ("race results" framing).
- Top speed private by default. Public leaderboard = km, checkpoints — never speed.

### NFS Underground skin
- One custom Mapbox Studio style: near-black base, neon route with glow (line-blur),
  accent POIs. Dark angular UI, italic condensed display type for numbers, glow on
  active states. Drive Mode favors glanceability over effects.

## 6. Data model (trimmed for the week, forward-compatible)

```
trips             id, name, status(draft|live|ended), organizer_id, route_geojson,
                  starts_at, invite_code, created_at
trip_members      trip_id, user_id (anon auth id), handle, car_model, car_color,
                  role(organizer|driver|passenger), share_location bool, joined_at
checkpoints       id, trip_id, name, kind(fuel|food|photo|meet), lat, lng, order_idx
location_samples  id, trip_id, user_id, lat, lng, speed, heading, accuracy, ts
trip_stats        trip_id, user_id, distance_km, moving_secs, avg_speed, top_speed,
                  checkpoints_hit, computed_at
```

Differences from v1: no standalone `users` table this week — identity is
anonymous-auth id + per-trip handle on `trip_members`. Phase 2 adds `users` and real
auth on top without breaking anything. RLS: everything scoped to `trip_members`;
live channel authorization checks membership of a *live* trip. Raw samples pruned
after aggregation.

## 7. Repo structure (the Phase-2 insurance policy)

```
supra-companion/
├── apps/web/                  # Vite + React PWA
│   ├── src/features/          # join, lobby, convoy-map, drive-mode, route-editor, results
│   ├── src/map/               # Mapbox GL JS layer (web-specific)
│   ├── src/location/          # watchPosition loop, wake lock, offline queue (web-specific)
│   └── src/theme/             # NFS design tokens
├── packages/core/             # PURE TS — no React, no DOM, no browser APIs
│   ├── gaps/                  # route snapping, P1/P2 ordering, time gaps
│   ├── stats/                 # distance/speed math, jitter filters
│   ├── protocol/              # realtime message types, channel names
│   └── types/                 # Trip, Member, Sample, Checkpoint
├── supabase/                  # migrations, RLS policies, stats Edge Function
└── docs/
   (Phase 2 adds apps/mobile — React Native — importing packages/core and supabase/ as-is)
```

pnpm workspaces. `packages/core` gets the only unit tests that matter this week
(gap engine + stats filters).

## 8. The seven days

| Day | Ship |
|---|---|
| **1** | **Apply for CarPlay entitlement (morning, in parallel).** Monorepo scaffold, Supabase project, schema + RLS, anonymous auth, trip create/join via invite code. |
| **2** | Mapbox neon style in Studio; convoy map with live positions end-to-end (two phones, real GPS). |
| **3** | Route editor (organizer) + route/checkpoint rendering; `packages/core` gap engine with tests. |
| **4** | Drive Mode screen: position, time gaps, km, next checkpoint; wake lock + visibility re-acquire; offline sample queue. |
| **5** | Stats: live counters + trip-end aggregation + results screen. PWA manifest, deploy, link in the group chat for a beta. |
| **6** | **Real drive test** (two+ cars, real roads, real dead zones). Fix what breaks. |
| **7** | Buffer + polish. Nothing new. |

Cut order if a day slips: route editor becomes "organizer pastes a GPX/coordinates
list" → checkpoint kinds become plain markers → results screen becomes a stats card.
The convoy map, gaps, and km counter are never cut — they are the app.

## 9. Top risks (week-one edition)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Screen-lock kills location broadcast | **High** | Wake lock + mounted-phone expectation in UI; "last seen" UX makes drops graceful, not broken |
| iOS Safari geolocation quirks (permission prompts, throttling) | Medium | Day-2 end-to-end test on real iPhones; add-to-homescreen standalone mode tested explicitly |
| Cellular dead zones | Certain | Offline sample queue + reconnect flush; "last seen" positions |
| GPS jitter inflating km | Medium | Accuracy/speed filters in `packages/core`, unit-tested day 3 |
| Scope creep | High | The cut order in §8 is pre-agreed; day 7 is a buffer |
| Phase-2 lock-in (accidentally web-coupled logic) | Medium | The `packages/core` purity rule; review imports before the trip |

## 10. After the trip (Phase 2)

1. CarPlay entitlement should be granted (applied day 1) → build `apps/mobile` per
   v1 of this doc: React Native + `react-native-carplay` + Mapbox Navigation SDK
   (`CarPlayManager`), importing `packages/core` and the same Supabase backend.
2. Real auth (Sign in with Apple/Google) + `users` table + garage/lifetime stats.
3. In-app turn-by-turn, Android background location, TestFlight → App Store.
4. Web app remains the no-install fallback and spectator view.
