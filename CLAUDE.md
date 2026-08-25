# CLAUDE.md — Real-Time Parcel Delivery Management System

Read this file at the start of every session. It is the source of truth. If a request in
chat conflicts with this file, say so before writing code.

Course project, CSC 470. Seven-day build. Demo-ready beats feature-complete.

---

## 1. Non-negotiable rules

1. **Never invent a color, font, radius, or spacing value.** Everything comes from
   `client/src/styles/tokens.css`. If a value you need isn't there, stop and ask.
2. **The design system is v3 Meridian, in docs/design-system-v3-meridian.html, and it
   is frozen.** M6.5c shipped — every screen in the route table now matches it, and
   the freeze from the original rule 2 applies to v3 in full: do not restyle a
   component because it "could look better," and do not invent colors, radii, fonts,
   or spacing outside it. Visual changes require an explicit request.
3. **The delivery state machine is enforced server-side.** The client never decides what
   transition is legal.
4. **TypeScript strict mode. No `any`.** If a type is hard, model it properly.
5. **One milestone per session.** Commit at the end. Don't start the next one.
6. **No secrets in the repo.** Everything through `.env`, with `.env.example` kept current.
7. **Vertical slices, not layers.** "Booking works end to end" before "all models exist."
8. **Deferred work lives in DEFERRED.md, not in the current milestone.** When you defer
   something, append it there with a target milestone and a one-line reason — don't fix
   it in the current session unless I ask. At the start of every milestone session listed
   in section 8, read that file's matching section and confirm scope with me before
   starting.

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
  design-system-v3-meridian.html   THE visual reference — read before building any UI
  design-system.html               v1, superseded. Kept for history only.
CLAUDE.md
.gitignore
.env.example     every required key, with empty values
```

---

## 4. Design tokens — v3 Meridian

`/docs/design-system-v3-meridian.html` is the visual source of truth. Open it before
building any screen and match it. It shows the palette, type scale, components, the
route table and the app shell. `tokens.css` is generated from it — if the two ever
disagree, the HTML wins.

The v1 system (warm paper, orange accent, header-only layout) is **retired**. Its
tokens no longer exist under any name, so a component still asking for `--paper` or
`--hairline` fails to build rather than quietly rendering the old look.

```css
/* chrome — the navigation frame, always dark, in both public and app */
--chrome:#1B1F27;  --chrome-2:#232936;  --chrome-3:#2E3542;
--chrome-ink:#F2F3F5;  --chrome-muted:#8A91A0;  --chrome-faint:#636A79;

/* workspace — never dark */
--page:#F7F8FA;  --surface:#FFFFFF;  --surface-sunk:#F1F3F6;
--border:#E7E9EE;  --border-strong:#D6D9E0;
--ink:#111420;  --ink-2:#3C4254;  --muted:#6C7280;  --faint:#9AA0AD;
--accent:#3B4EF0;  --accent-hover:#2E3ECC;  --accent-tint:#EEF0FE;
--accent-on-dark:#8FA0FF;   /* the accent, readable on chrome. Never on --surface */

/* lifecycle ramp — cool rotation, energy rising, ending green */
--s-booked:#7C8394;     --s-assigned:#8B5CF6;   --s-picked:#06A6C2;
--s-transit:#3B4EF0;    --s-delivered:#12996B;  --s-failed:#DC3A34;
--s-pending:#C4820A;    /* a rider awaiting approval — the only amber */
--s-cancelled: var(--s-booked);   /* by name; a cancelled parcel is inert, not failed */

--radius-sm:8px;  --radius-md:12px;  --radius-lg:16px;  --radius-xl:20px;
--radius-chip:11px;  --radius-mark:3px;  --radius-pill:999px;

/* type scale, named by the job a component is choosing */
--text-rail:10px;      --text-micro:10.5px;   --text-eyebrow:11px;
--text-tiny:11.5px;    --text-meta:12px;      --text-small:12.5px;
--text-sm:13px;        --text-body:13.5px;    --text-control:14px;
--text-base:14.5px;    --text-md:15px;        --text-lg:16px;
--text-mark:17px;      --text-title:21px;     --text-h2:26px;   --text-hero:30px;
--text-figure:19px;    --text-figure-lg:24px; --text-figure-xl:27px;   /* mono */

/* grid steps — --space-N is N x 4px */
--space-1:4px;    --space-2:8px;    --space-3:12px;
--space-4:16px;   --space-5:20px;   --space-6:24px;
--space-7:28px;   --space-8:32px;   --space-10:40px;
--space-14:56px;  --space-16:64px;

/* optical steps — the off-grid values the reference actually uses.
   Named in literal pixels because most are odd numbers that no fraction
   of the 4px grid names readably. */
--space-3px:3px;    --space-5px:5px;    --space-6px:6px;    --space-7px:7px;
--space-9px:9px;    --space-10px:10px;  --space-11px:11px;  --space-13px:13px;
--space-14px:14px;  --space-15px:15px;  --space-17px:17px;  --space-18px:18px;
--space-19px:19px;  --space-21px:21px;  --space-22px:22px;  --space-26px:26px;
--space-30px:30px;  --space-34px:34px;
```

- Two families, one scale. Reach for a **grid step** when you are choosing
  spacing. Reach for an **optical step** only to match a specific value in the
  reference — they exist so those values are tokens rather than raw pixels, not
  to widen the palette of choices.
- `--space-14` is 56px and `--space-14px` is 14px. The `px` suffix always means
  literal pixels.

- Fonts: **Inter Tight** (UI), **JetBrains Mono** (all numbers, IDs, money, times).
  Montserrat is gone with the old wordmark — v3 sets the wordmark in Inter Tight 700.
- **No gradients. No drop shadows.** Separation comes from 1px borders.
- **In transit IS the accent.** The brand colour is a lifecycle state, not decoration:
  when a parcel is moving, ultramarine is on screen; when nothing moves, the interface
  goes quiet. One accent button per view, and admin actions use ink.
- **Disabled is neutral**, never a faded accent — a tinted disabled button reads as
  broken rather than as unavailable.
- Every number on screen — price, weight, tracking ID, COD amount, timestamp — uses the
  mono face with `font-variant-numeric: tabular-nums`.
- Agent UI is light, large tap targets (min 48px), one-handed. Riders work in daylight,
  which is also why the rider screens reach for `--ink-2` where the reference uses
  `--faint`: at 10-11px, `--faint` measures 2.6:1 on white.

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
`agent.currentLocation`, filtered to `status: 'available'`, `approvalStatus: 'approved'`,
and matching zone. Falls back to zone-only if no agent is within 5 km. Admin can override,
but the override is still bound by the same approval check. A self-registered rider starts
`pending` and is invisible to both paths until an admin approves them from `/admin/agents`.

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
| M6.5 | Visual system replacement (Meridian v3), three sessions: **a** shell + routes + re-skin existing screens, **b** rider workspace rebuild, **c** landing + signup + approval flow + profiles | Every screen matches docs/design-system-v3-meridian.html; no v1 token survives in the codebase |
| M7 | Deploy + rehearse | Live on Vercel + Render + Atlas, demo data seeded, run-through twice |

See DEFERRED.md for work parked out of each milestone.

If M3 slips, cut M6 before cutting anything in M4. Live tracking is the flagship.

---

## 9. Demo data

Dhaka zones: Dhanmondi, Mirpur, Uttara, Bashundhara, Gulshan, Mohammadpur.
Currency ৳ (BDT), `en-BD` formatting. Tracking ID format `PD-XXXX-XX`.
Seed 3 customers, 5 agents (2 available, 1 on delivery, 1 offline, 1 pending approval),
1 admin, ~20 parcels spread across all lifecycle states including one Failed and one
Delayed.

---

## 10. Definition of done for any feature

- Types flow from the shared Zod schema, no duplicated interfaces
- Loading, empty, and error states exist — not just the happy path
- Server validates input even when the client already did
- Works at 375px wide
- Keyboard focus is visible
- No console errors
