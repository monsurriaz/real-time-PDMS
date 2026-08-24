# Real-Time PDMS — status after M4 (live tracking)

Handoff for planning M5+. Self-contained: assumes no prior context.

## The project

CSC 470 course project, seven-day build, demo-ready beats feature-complete.
A parcel delivery management system for Dhaka with three roles (customer,
agent, admin) and live rider tracking as the flagship feature.

`CLAUDE.md` in the repo root is the source of truth and overrides anything
here. `DEFERRED.md` holds consciously parked work, by target milestone
(CLAUDE.md rule 8 requires reading it at the start of M5, M6 and M7).

**Stack:** React 18 + Vite + TS, Tailwind driven entirely by CSS custom
properties from a frozen design system; Node + Express + TS; Socket.io;
MongoDB Atlas + Mongoose with 2dsphere indexes; Zod schemas in `/shared`
imported by both sides; JWT in httpOnly cookies; MapLibre GL JS over
OpenFreeMap tiles; Nominatim geocoding; OpenRouteService distance/routing.
All free tier — that constraint is real and shapes several decisions below.

**Layout:** npm workspaces — `/client`, `/server`, `/shared`, `/scripts`.

## Milestones complete

| M | Scope | Commit |
|---|---|---|
| M1 | Skeleton + auth (models, Zod schemas, seed, JWT, role-gated routes) | `978aeb0` |
| M2 | Booking + pricing (geocode, distance, price snapshot, admin pricing editor) | `7f6cf7d` |
| M3 | Assignment + lifecycle (one transition map, `$near`, POD gate) | `91f12d8` |
| M3.5 | Agent shift controls, auto-assign on booking, phone-mockup agent screen | `2b29f48` |
| M4 | Live tracking (sockets, MapLibre, REST fallback, simulator) | `ba53d95` |
| — | Post-M4 bug fixes (blank map, logout 401s, fleet dedupe) | `2ec6f13` |

Remaining: **M5** (POD + payments), **M6** (analytics + polish), **M7**
(deploy + rehearse).

## What M4 delivered

**Socket layer** (`server/src/sockets`)
- Handshake authenticates by reading the same JWT cookie the REST layer uses.
  No second auth mechanism.
- Room authorisation *reuses the REST role scoping literally*: joining
  `parcel:{id}` runs a scoped Mongoose query inside the joiner's async
  context, so the query middleware that hides a parcel also refuses the room.
  There is no separate socket permission model that can drift.
- Rate limit: one `location:update` per agent per 3 seconds, excess **dropped**
  rather than queued (a queue would replay a stale burst).
- Persist throttle: a position reaches Mongo at most once per 30 seconds.
  Every accepted tick is broadcast; only the slow cadence is written.
- `advanceStatus()` emits `status:changed` through a one-slot broadcaster
  registry, so the lifecycle service stays the single status path without
  importing the socket server (unit tests and the seed need no socket).
- Ticks are acked to the publisher — the agent is publish-only per spec, so
  without an ack a phone could never know whether a tick landed.

**Client**
- Customer tracking screen: 340px detail column beside the map, lifecycle rail
  with labels, rider card, key-value block, event timeline. Rider markers
  interpolate between points with an eased 2.6s glide started from the marker's
  current position (so a mid-glide update doesn't snap backwards). Location
  history capped at 200 points per session.
- Connection state is stated plainly — `Live` / `Reconnecting — refreshing
  every 10s` / `Offline` — because a stale position that looks current is worse
  than an honest "reconnecting".
- The lifecycle rail's travelling highlight is a **liveness indicator wired to
  real connection state**, not an unconditional animation. Moving = socket
  updates arriving; frozen = socket dropped, on REST fallback. Defaults to off
  so it can't shimmer by accident, never attaches to a finished parcel, and
  `prefers-reduced-motion` swaps the sweep for a *static* highlight rather than
  removing it (losing the animation shouldn't lose the signal).
- Admin fleet map sits **above** the existing delivery board; the table was not
  rebuilt. `status:changed` invalidates both, so the board updates with no
  manual refresh.

**Simulator** (`scripts/simulate.ts`) — the thing that makes the flagship
demoable. Follows real OpenRouteService road geometry, cached on the existing
RouteCache row beside the distance.

Important: `--speed` scales **metres per tick, not tick frequency**. An early
version emitted every 150ms at 20x and the server's own 3s rate limit dropped
265 of 289 ticks, so the marker teleported. Now 30 km/h ≈ 25 m per 3s tick and
Nx covers N times that.

## Verified numbers (measured, not estimated)

- **Persist throttle:** a 106-second simulated run emitted 36 ticks, all 36
  accepted, and wrote **4** documents to Mongo.
- **Rate limit:** a burst of 10 ticks in one instant → exactly 1 accepted,
  9 rate-limited. 4 acceptances across 12s → 0 writes.
- **Fallback:** socket live = 4 positions/10s → `socket.disconnect()` → 0 socket
  ticks but REST polling returned positions updating exactly 30s apart
  (18:51:46 → 18:52:16, matching the write throttle) → reconnect restored
  4 positions/10s.
- **13 socket checks:** unauthenticated and forged handshakes refused; owner
  joins; a different customer refused and receiving zero broadcasts; admin
  joins any; publisher excluded from its own room; `status:changed` reaches the
  room; a finished delivery refuses positions.
- **Browser-verified over CDP:** customer tracking renders a 782×585 container
  with matching canvas, 1 rider marker, 2 endpoint pins, `data-live="true"`,
  one attribution line, and **zero console errors / zero 4xx-5xx**.
- 23 unit tests pass, typecheck clean across all three workspaces, client
  builds.
- Pricing: CLAUDE.md's documented example (3 km, 2 kg → ৳126) reproduces
  through the live API, not just a unit test.

## Bugs found and fixed after the M4 report

These were reported by the user against the shipped M4 build and are fixed in
`2ec6f13`. Worth knowing because two are general traps.

1. **Blank map — zero-height container.** MapLibre stamps
   `.maplibregl-map { position: relative }` onto whatever element it is given.
   The map div was sized with `absolute inset-0`, so two rules fought over
   `position` and the winner depended on **CSS source order, not class order**.
   In production Tailwind's utilities land after maplibre's stylesheet and
   `absolute` won; in dev Vite injects maplibre's CSS when the component loads
   — after the entry stylesheet — so `relative` won, `inset-0` stopped
   stretching the box, and it collapsed to height 0. The canvas fell back to
   its 300px minimum inside a 0px container and painted the style's near-white
   background: a white rectangle, **dev only**. Container measured 782x0 before,
   782x585 after. Fixed by sizing with `w-full h-full`, immune to ordering.
   Three further defects in the same component were found while verifying: no
   `ResizeObserver` (a map built before its container had height could never
   recover), the route/pin/`fitBounds` effect applying to the map discarded by
   React StrictMode's dev remount rather than the live one, and no `error`
   handler so failures were silent.

2. **401s on `/api/tracking` after sign-out.** Signing out closes the socket,
   the tracking page's disconnect handler flips to polling mode, and polling
   then hit `/tracking/:id` with a cookie that no longer existed — once per 10s
   until the route unmounted. The query and socket are now gated on having a
   session. The one remaining 401 on `/auth/me` after sign-out is correct and
   unavoidable: with an httpOnly cookie the client cannot know it is signed out
   without asking, and the login screen has to ask.

3. **Fleet map miscounted.** It drew one marker per *delivery*, so a rider
   holding three parcels appeared three times stacked and the panel read
   "8 riders" when there were 3. Now collapsed per rider with the freshest
   position: "Fleet · 3 riders · 8 active deliveries".

4. **Map attribution printed twice.** Corrects an earlier claim: the positron
   style's TileJSON **does** supply "OpenFreeMap © OpenMapTiles Data from
   OpenStreetMap" — verified in a real browser, which an earlier curl check
   could not do. The belt-and-braces `customAttribution` was therefore
   redundant and has been removed. One credit line, still rendering.

5. Added an inline SVG favicon; the missing `/favicon.ico` was logging a 404
   and CLAUDE.md §10 requires no console errors.

## Decisions that constrain future work

- **`advanceStatus()` is the only path that changes delivery status**, and it
  owns both legality (a single transition map) and authority (a separate
  role map). Anything touching the lifecycle must go through it.
- **Prices are snapshotted onto the parcel at booking.** `Parcel.price` is
  `immutable` on the schema, so editing pricing config can never retroactively
  change a booked price. M5 payments must read the snapshot, not recompute.
- **`delivery.events[]` is append-only**, enforced by model hooks that reject
  `$set`/`$pull` against it. Use `$push`.
- **Role scoping is Mongoose query middleware**, not per-handler filters,
  keyed on AsyncLocalStorage. Never use aggregations for user-facing reads —
  `$lookup` bypasses the middleware entirely and would silently defeat scoping.
- **`Delivered` requires proof of delivery already on the record.** M3 enforces
  the precondition; capture is an admin/test-only stub today. This is M5's
  first job.
- **Free-tier discipline:** never add a dependency without asking; Nominatim is
  1 req/sec with every result cached (misses too); ORS results cached per
  address pair; locations written to Mongo at most 1/30s.
- **The design system is frozen.** Every colour, radius, font and spacing value
  comes from `client/src/styles/tokens.css`, generated from
  `docs/design-system.html` (the HTML wins on disagreement). Tailwind's default
  palette is cleared, so `bg-blue-500` genuinely does not exist.

## Deferred backlog — the planning input

**M5 (POD + payments)**
- Real proof-of-delivery capture. M3 enforces the precondition only; the
  agent screen has inert dashed Photo/OTP placeholders matching the design
  mockup, and a working signed-for-name capture wired into that same area.
  Replace with real photo upload (Cloudinary unsigned preset) and OTP.

**M6 (analytics + polish)** — 10 items, highest-value first
- **Weight cap gap (from M2, flagged as the top item).** Pricing tiers stop at
  5 kg; a customer entering 8 kg gets a 422 with no path forward. Suggested fix
  is a formula tier (e.g. 5–20 kg: ৳130 + ৳15/kg over 5) rather than a flat
  fee. **This is a dead end a real user can hit.**
- Map bundle weight: MapLibre pushes the client bundle from ~500 KB to ~1.5 MB
  (403 KB gzipped). Fix with `React.lazy` so only tracking screens pay.
- `advanceStatus` is the only status path *by convention, not enforcement* —
  `DeliveryModel` is importable and any future route could `$set: { status }`.
  Options: a pre-hook rejecting unmarked status writes, or a repository that
  exposes no status setter.
- Assignment ignores rider workload (`$near` filters on availability only).
- No admin "unassign" (would mean adding a lifecycle transition — decide
  deliberately).
- Admin fleet map joins N parcel rooms rather than one `admin:fleet` room.
- Route geometry cache has no TTL.
- Rider marker hidden under the ink pickup pin when parked at pickup.
- `.b-cancelled` badge variant doesn't exist by name (Cancelled borrows
  Booked's grey — correct behaviour, missing token).
- Design debt: `rounded-[2px]`, `text-[13.5px]`, `text-[14.5px]` not
  token-backed.

**M7 (deploy + rehearse)**
- Narrow Atlas network access (currently `0.0.0.0/0`).
- Rehearsal check: if the weight-cap fix hasn't landed, ensure no demo booking
  exceeds 5 kg — a 422 mid-demo would be avoidable.

## How to run and demo it

```bash
npm install
npm run seed        # 6 Dhaka zones, pricing config, 8 accounts, 20 parcels
npm run dev         # client :5173, server :5001 (5000 is macOS AirPlay)
npm test            # 23 unit tests
npm run typecheck

# the flagship demo — terminal 2, with dev running
npm run simulate -- --tracking PD-SEED-03 --speed 20
```

Demo logins, password `pdms-demo-2026` for all:
`nusrat@demo.pdms` (customer), `rakib@demo.pdms` (agent),
`admin@demo.pdms` (admin). Plus `tanvir@`/`sadia@` customers and
`sabbir@`/`imran@`/`jahid@` agents in varied availability states.

Seed data: 20 parcels across all seven lifecycle states including one Failed
and one overdue Booked. The seed is idempotent and rebuilds only `PD-SEED-*`,
so parcels booked through the UI survive it.

API surface: `/auth`, `/zones`, `/pricing`, `/parcels`, `/deliveries`,
`/agents`, `/tracking`.

## Suggested next step

M5 is POD + payments. Per CLAUDE.md rule 8, M5 starts by reading DEFERRED.md's
M5 section and confirming scope. The natural sequence: real POD capture first
(it removes the stub and completes the `Delivered` precondition already
enforced server-side), then Stripe test-mode checkout behind the
`PaymentProvider` interface CLAUDE.md §2 asks for, then the COD flag and the
per-agent reconciliation table.

Worth deciding early: whether the M6 weight-cap fix should be pulled forward
into M5. It is a user-reachable dead end, and CLAUDE.md says to cut M6 before
cutting anything in M4 — which implies M6 is the milestone most likely to be
squeezed.
