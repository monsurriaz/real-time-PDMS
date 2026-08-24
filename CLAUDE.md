# CLAUDE.md — Real-Time Parcel Delivery Management System

Read this file at the start of every session. It is the source of truth. If a request in
chat conflicts with this file, say so before writing code.

Course project, CSC 470. Seven-day build. Demo-ready beats feature-complete.

---

## 1. Non-negotiable rules

1. **Never invent a color, font, radius, or spacing value.** Everything comes from
   `client/src/styles/tokens.css`. If a value you need isn't there, stop and ask.
2. **The design system is frozen.** Do not restyle a component because it "could look
   better." Visual changes require an explicit request.
3. **The delivery state machine is enforced server-side.** The client never decides what
   transition is legal.
4. **TypeScript strict mode. No `any`.** If a type is hard, model it properly.
5. **One milestone per session.** Commit at the end. Don't start the next one.
6. **No secrets in the repo.** Everything through `.env`, with `.env.example` kept current.
7. **Vertical slices, not layers.** "Booking works end to end" before "all models exist."

---

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript, React Router |
| Styling | Tailwind + CSS custom properties from `tokens.css` |
| Server state | TanStack Query. Client state: Zustand (thin) |
| Backend | Node.js + Express + TypeScript |
| Real-time | Socket.io (rooms per parcel) |
| Database | MongoDB Atlas + Mongoose, `2dsphere` indexes |
| Validation | Zod schemas in `/shared`, imported by both sides |
| Auth | JWT in httpOnly cookies, role claim embedded |
| Map render | MapLibre GL JS |
| Map tiles | OpenFreeMap — `https://tiles.openfreemap.org/styles/positron`. No key, no quota |
| Geocoding | Nominatim public instance. Max 1 req/sec, custom `User-Agent` required, cache every result in Mongo |
| Distance / route | OpenRouteService (free API key) |
| Media | Cloudinary unsigned upload preset |
| Payments | Stripe test mode behind a `PaymentProvider` interface |
| Deploy | Vercel (client) + Render (server) + Atlas (db) |

**Never add a dependency without asking.** The free-tier constraint is real.

---

## 3. Repo layout

```
/client          Vite React app
  /src
    /components  shared UI (Button, Badge, LifecycleRail, StatCard, Field)
    /features    booking/ tracking/ agent/ admin/ auth/
    /lib         api client, socket client, maplibre setup
    /styles      tokens.css  ← the design system, do not edit casually
/server
  /src
    /models      Mongoose schemas
    /routes      Express routers
    /services    business logic (pricing, assignment, lifecycle)
    /sockets     Socket.io handlers
    /lib         geocode, routing, payments, cloudinary
/shared
  /schemas       Zod schemas + inferred types, imported by both sides
/scripts
  seed.ts        zones, pricing config, demo users, riders
  simulate.ts    fake rider GPS along a Dhaka route  ← needed to demo tracking
/docs
  design-system.html   the locked visual reference — read before building any UI
CLAUDE.md
.gitignore
.env.example     every required key, with empty values
```

---

## 4. Design tokens (locked)

`/docs/design-system.html` is the visual source of truth. Open it before building any
screen and match it. It shows the palette, type scale, components, and the three role
layouts. `tokens.css` is generated from it — if the two ever disagree, the HTML wins.

```css
--paper:#FAF9F7;  --surface:#FFFFFF;  --surface-sunk:#F4F2EE;
--hairline:#E9E6E0;  --hairline-strong:#D8D4CC;
--ink:#14140F;  --ink-2:#4A4740;  --muted:#6B6862;  --faint:#9C988F;
--accent:#EA4E1B;  --accent-press:#C63E11;  --accent-tint:#FFF1EB;

--s-booked:#8A8F98;     --s-assigned:#4C6EF5;   --s-picked:#0E9891;
--s-transit:#EA4E1B;    --s-delivered:#17864F;  --s-failed:#C9342C;

--radius-sm:8px;  --radius:12px;  --radius-lg:16px;

--space-1:4px;    --space-2:8px;    --space-3:12px;
--space-4:16px;   --space-5:20px;   --space-6:24px;
--space-7:28px;   --space-8:32px;   --space-10:40px;
--space-14:56px;  --space-16:64px;
```

- Fonts: **Manrope** (UI), **JetBrains Mono** (all numbers, IDs, money, times),
  **Montserrat 700** (wordmark only).
- **No gradients. No drop shadows.** Separation comes from 1px hairlines.
- Every number on screen — price, weight, tracking ID, COD amount, timestamp — uses the
  mono face with `font-variant-numeric: tabular-nums`.
- Orange means "moving." One orange button per screen, maximum. Admin actions use ink.
- Agent UI is light, large tap targets (min 48px), one-handed. Riders work in daylight.

---

## 5. Domain model

Entities: `User`, `Agent`, `Parcel`, `Delivery`, `Payment`, `Zone`.

### Delivery lifecycle

```
Booked → Assigned → PickedUp → InTransit → Delivered   (terminal)
                 ↘ Cancelled (before PickedUp only)
                 ↘ Failed    (from InTransit only)
```

- Reassignment is allowed **only** before `PickedUp`.
- `Delivered` requires proof of delivery already stored on the record.
- Legal transitions live in one map in `server/src/services/lifecycle.ts`. Every status
  change goes through `advanceStatus()`. No route mutates `status` directly.
- Every transition appends to `delivery.events[]` with actor, timestamp, and coordinates.

### Pricing

`price = zoneBase + (distanceKm × perKmRate) + weightTierSurcharge`

All three come from a single `PricingConfig` document, **never hard-coded anywhere**.
Distance from OpenRouteService, cached per address pair.

**Admins edit pricing from the dashboard.** `PricingConfig` holds `perKmRate`, an ordered
array of weight tiers (`{ maxKg, baseFee, label }`), and an optional per-zone base
override. The admin pricing screen reads and writes this document; no deploy is needed to
change a rate. Seed values: ৳60 up to 1 kg, ৳90 for 1–3 kg, ৳130 for 3–5 kg.

Rules:
- A price is **snapshotted onto the parcel at booking time**. Editing config later must
  never retroactively change an existing parcel's price.
- Validate on save: tiers must be ascending and non-overlapping, all fees ≥ 0.
- Show the admin a live worked example ("3 km, 2 kg → ৳ 126") as they edit.

### Assignment

Nearest available agent to the pickup point via `$near` on a `2dsphere` index over
`agent.currentLocation`, filtered to `status: 'available'` and matching zone. Falls back
to zone-only if no agent is within 5 km. Admin can override.

---

## 6. Real-time

- Socket rooms: `parcel:{id}`. Customer and admin subscribe; the agent publishes.
- Agent emits `location:update` at most every 3 seconds while a delivery is active.
- Server broadcasts `location:broadcast` and `status:changed` to the room.
- Client falls back to REST polling every 10s if the socket drops.
- Cap retained client-side location history at 200 points per session.
- **Location updates are not persisted per-tick.** Write a location to Mongo at most once
  per 30 seconds, otherwise the free tier drowns.

---

## 7. Security

- Customers see only their own parcels. Agents see only their assignments. Admins see all.
- Enforce role scoping in a query middleware, not in each route handler.
- Socket connections are authenticated on handshake; joining `parcel:{id}` is authorized
  against the same rules.
- Never send `passwordHash`, payment secrets, or another user's phone number to the client.

---

## 8. Milestones

| M | Scope | Done when |
|---|---|---|
| M0 | Design system + static shells | Tokens, fonts, MapLibre style, three role layouts with mock data |
| M1 | Skeleton + auth | Models, Zod schemas, seed script, JWT login, role-gated routes |
| M2 | Booking + pricing | Address geocoded, distance fetched, price computed from `PricingConfig`, parcel saved and listed, admin pricing editor works |
| M3 | Assignment + lifecycle | `$near` assignment, admin reassign, agent advances status, illegal transitions rejected |
| M4 | Live tracking + simulator | Rooms, GPS stream, animated customer map, admin live board, `simulate.ts` works |
| M5 | POD + payments | Photo/OTP stored, Stripe test checkout, COD flag, reconciliation table per agent |
| M6 | Analytics + polish | Stat cards, one chart, delayed alerts, loading/empty/error states, agent mobile pass |
| M7 | Deploy + rehearse | Live on Vercel + Render + Atlas, demo data seeded, run-through twice |

If M3 slips, cut M6 before cutting anything in M4. Live tracking is the flagship.

---

## 9. Demo data

Dhaka zones: Dhanmondi, Mirpur, Uttara, Bashundhara, Gulshan, Mohammadpur.
Currency ৳ (BDT), `en-BD` formatting. Tracking ID format `PD-XXXX-XX`.
Seed 3 customers, 4 agents (2 available, 1 on delivery, 1 offline), 1 admin, ~20 parcels
spread across all lifecycle states including one Failed and one Delayed.

---

## 10. Definition of done for any feature

- Types flow from the shared Zod schema, no duplicated interfaces
- Loading, empty, and error states exist — not just the happy path
- Server validates input even when the client already did
- Works at 375px wide
- Keyboard focus is visible
- No console errors

