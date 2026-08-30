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
   or spacing outside it. Visual changes require an explicit request. **M9.5 narrows
   this for exactly two routes**: `docs/design-v4-landing-login.html` (v4 Meridian)
   supersedes v3/v3.1 for the public landing page (`/`) and `/login` only — see
   section 4. Every other screen, including `/signup`, stays under v3 + v3.1 as
   written above.
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
  design-system-v3.1-addendum.html M6.96 corrections to v3 — read alongside it, wins on conflict
  design-v4-landing-login.html     M9.5 — supersedes v3/v3.1 for `/` and `/login` ONLY
  design-system.html               v1, superseded. Kept for history only.
CLAUDE.md
.gitignore
.env.example     every required key, with empty values
```

**Semantic page classes** (M6.97). Every top-level route component carries an identifying
class on its own outermost element — `<role>-<screen>`, kebab-case, matching the route
(`/admin/board` → `admin-board`, `/agent/runs/:id` → `agent-run-detail`). It carries no
styles; it exists so a screen can be targeted by what it IS, not by a layout class that
could change under it. `AppShell` takes this as a required `pageClass` prop (so the
compiler catches a page that forgot one); `AuthSplit` takes the same for `/signup`, and
`LoginSplit` (M9.5's own shell for `/login` — see section 4) takes it for `/login`;
the handful of routes with no shared shell (`/`, `/agent/pending`, `/track/:trackingId`)
put the class directly on their own root element. A new route follows this
automatically — `pageClass` being required is what makes it a compile error to skip,
not tribal knowledge.

---

## 4. Design tokens — v3 Meridian

`/docs/design-system-v3-meridian.html` is the visual source of truth. Open it before
building any screen and match it. It shows the palette, type scale, components, the
route table and the app shell. `tokens.css` is generated from it — if the two ever
disagree, the HTML wins.

**`/docs/design-system-v3.1-addendum.html` corrects v3 in six places** (M6.96): the
footer rule, the landing hero composition, a login/signup split-screen layout, three
header controls, a compact `LifecycleRail` variant, and the map's route/marker
rendering. It is read together with the v3 file, not instead of it — where the two
disagree, the addendum wins, and it is now part of the frozen visual reference rule 2
protects. It is a small standalone doc with its own simplified stylesheet, not
generated from `tokens.css`, so a few of its raw pixel values (padding, mostly) don't
land exactly on an existing step — those are implemented at the CLOSEST existing
token rather than by minting a new one. Container widths, heights and breakpoints are
not spacing values and were never drawn from the scale in the first place (the
codebase's own long-standing convention — `max-w-[400px]`, `min-h-[340px]`, and
similar one-off layout facts already appear throughout); only interior
padding/margin/gap is a rule-1 spacing decision.

**`/docs/design-v4-landing-login.html` (v4 Meridian) supersedes v3/v3.1, but ONLY for
the public landing page (`/`) and `/login`** (M9.5). Every other screen — everything
behind the rail, plus `/signup` and `/track/:trackingId` — stays under v3 + v3.1
exactly as above; `/signup` keeps `AuthSplit` unchanged this session even though
`/login` moved to a new `LoginSplit` shell, precisely so the two do not silently
diverge without it being a decision someone made on purpose. v4 introduces:

- **`--night: #12151b`, a new token** (tokens.css), one step darker than `--chrome`.
  Used only behind the landing hero's and the login left panel's full-bleed map —
  if that map sat on `--chrome` instead, the floating chrome-coloured pill nav
  couldn't be told apart from what's behind it. No other surface uses it; every
  other dark surface in the app is still `--chrome`.
- **One gradient exception.** Rule 2 above still holds everywhere else: v3/v3.1 has
  no gradients, separation comes from 1px borders. The v4 hero and the login left
  panel put real map tiles full-bleed behind text, and only a radial veil — darkest
  behind the copy, lighter toward the frame — keeps that text legible at every point
  without flattening the map into an opaque card. It exists for contrast, not
  decoration, and it is implemented in exactly one place, `.hero-veil` /
  `.login-veil` in `app.css`, as `color-mix()` against `--night` rather than a
  literal colour, so it can never drift from that token. No other gradient exists
  anywhere in the codebase.
- **Real markers, coloured by lifecycle state.** The hero's and the bento grid's
  maps are real `TrackingMap` instances (`LazyTrackingMap`, the same lazy chunk
  every tracking screen already loads), not images. `MapRider` gained an optional
  `tone` field so the SAME marker component can show the five-colour ramp at once;
  every existing caller (`RunMap`, `FleetMap`) omits it and renders exactly as
  before. The hero's rider pins are deliberately static/decorative, not live fleet
  data — see DEFERRED.md, M9.5, for why.

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
Booked → Assigned(offered) → Accepted → PickedUp → InTransit → Delivered   (terminal)
                    ↘ Cancelled (before PickedUp only)
                    ↘ Failed    (from InTransit only)
Assigned  ↘ declined by the rider, or the offer expired → Booked, unassigned
Accepted  ↘ admin reassigns before pickup                → Assigned, a fresh offer
```

- **`Assigned` means offered, not held** (M8). A rider has not committed until `Accepted`.
  Anywhere in the code that means "this rider is actually carrying it" — workload
  counting, a rider's own active-count, the GPS-publish gate — keys off `Accepted`, not
  bare `Assigned`. Anywhere that means "still open, not yet finished" — notifications,
  analytics, the customer's rail count — keys off both.
- Only the assigned rider may accept or decline an offer, and only before `PickedUp`.
  Admin cannot accept or decline on a rider's behalf — it can reassign (a fresh offer)
  or cancel outright, but not answer an offer for someone else.
- **Decline** returns the delivery to `Booked`, unassigned, and records who declined —
  that rider is permanently excluded from being offered *that* delivery again (not from
  the roster generally). Auto-assignment and an admin's manual override both honour the
  exclusion.
- **Offer expiry is evaluated on read, not on a schedule** — Render's free tier sleeps,
  so cron/`setInterval` cannot be trusted to fire. Every read path that loads a delivery
  (the admin board, an agent's runs, a tracking screen) checks the current offer's
  deadline first; past it, the delivery falls through to `Booked` at that moment,
  idempotently, and the rider who let it lapse is excluded the same way a decline is.
  The window defaults to one hour and is configured by `OFFER_WINDOW_MINUTES` in `.env`.
- Reassignment is allowed **only** before `PickedUp` — now spanning `Assigned` and
  `Accepted` both.
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
- **`Parcel.codAmount` is set server-side from that snapshot**, never from the request.
  The booking input schema has no such field, so a customer cannot declare what a rider
  must collect — which they could until M6.9.
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
- Never send `passwordHash`, payment secrets, or another user's phone number to the client —
  **narrowed by M9**: the recipient of a delivery has no account on the platform, so the
  rider at the door has to be able to call them. Their phone reaches the currently assigned
  rider only, and only while the delivery is non-terminal — never any other rider, never a
  customer (including the sender who typed it in at booking), never the public tracking
  payload. Scoped server-side (`routes/deliveries.ts`'s `toListItems`), never left to the
  client to withhold.
- **`User.status` is checked on every authenticated request**, in `requireAuth`, and on the
  socket handshake. A JWT is a bearer token: checking it only at login means a suspended
  account keeps working until its cookie expires. A suspended caller gets a 403 carrying
  `reason: 'account_suspended'`, never a 401 — they are identified, just not allowed.
- **Customer <-> rider messaging (M9)** reuses the `parcel:{id}` socket room and its
  existing role scoping wholesale, rather than a second room topology or permission model.
  Participants are the parcel's customer and its currently assigned rider only; an admin may
  read a thread but never post to it. The window opens at `PickedUp` and closes the moment
  the delivery reaches any terminal state — enforced server-side on every post, not just by
  hiding the input client-side.
- **Profile photos (M9.6)**, `avatarUrl` on `User`, narrow the same way the recipient's phone
  does: your own is always visible to you (rail, profile); the ASSIGNED rider's reaches that
  parcel's customer on **authenticated** tracking only (`routes/tracking.ts`'s `/:parcelId`) —
  never on public tracking (`/by-id/:trackingId`), which stays exactly `{ name, vehicle }`, and
  never a customer's own avatar back to the rider. Admin sees every avatar its existing screens
  already carry a name for (`/admin/agents`, `/admin/customers`, the COD table) — no new field
  was added anywhere that didn't already carry that person. Uploads reuse the POD photo path
  wholesale: browser -> Cloudinary with the same unsigned preset, the server checking a
  submitted URL names our own cloud before storing it, no new env var. Clearing a photo (self
  or admin) unsets `avatarUrl` only — the Cloudinary asset itself is orphaned, the same
  accepted limitation POD photos have had since M5.

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
| M6.9 | Pre-deploy fixes: booking/payment redirect, customer suspension, one-time welcome, COD amount integrity, search copy | Six unrelated defects closed; suspension enforced in `requireAuth` on every request, not at login |
| M6.96 | UI corrections against the v3.1 addendum: footer rule, landing hero, auth split-screen, header search/notifications/avatar, compact rail variant, map rendering | Every item in the addendum matches; merged to main via PR |
| M6.97 | Map regression fix (rider z-index never actually applied, a marker-ordering race, a socket-auth bug blocking every pre-M6.9 rider from a live connection at all) + semantic page classes on every route | All four map-bearing surfaces re-verified individually with real position data; every route in the table carries its class, compiler-enforced |
| M6.98 | Live board fixes: fleet map sourced from Agent (not delivery rooms), showing every on-shift rider — idle and busy, two marker treatments; assign/reassign moved from an inline panel to a modal; the rail's Shift editor rebuilt on the same modal after it turned out to render underneath the map on wide viewports | Fleet map verified with both marker types and idle riders visible; the assign modal and the Shift modal both confirmed by screenshot; merged via PR |
| M8 | Offer/accept/decline lifecycle: `Assigned` redefined as an offer awaiting response, a new `Accepted` state, decline with per-delivery exclusion from re-offer, expiry evaluated on read (not scheduled), agent Accept/Decline UI with a countdown | Exhaustive NxN transition tests pass; a declined or expired offer is never re-offered to the same rider; the lifecycle ramp still uses five colours; expiry demoed end to end with a short window |
| M9 | Recipient phone narrowed to the assigned rider (Call as a real `tel:` link, Navigate removed outright), customer <-> rider messaging windowed to PickedUp-through-terminal reusing the existing socket room, agent suspension via `User.status` refused while carrying a picked-up parcel | A full message exchange demoed, then the thread goes read-only on delivery and the server rejects a post after that; a third customer cannot read the thread; the recipient's phone reaches the assigned rider only, confirmed against the public tracking payload and another rider's payload; suspension refused for an agent carrying a picked-up parcel, and pre-pickup offers/accepted jobs return to the pool through the existing reassign-before-pickup transition, no new one added |
| M9.5 | Landing + login redesign (v4 Meridian, scoped to `/` and `/login` only): nine-section landing with a real full-bleed hero map, an asymmetric bento grid, live pricing tiers, a real FAQ accordion, and a map-treated login left panel with three vertical anchors | All nine landing sections render at 1440px and 375px with no page ending early; pricing and FAQ read from live `PricingConfig`/checked code behaviour, not invented copy; `/signup` and every screen behind the rail unchanged; merged via PR |
| M9.6 | Profile photos (`avatarUrl` on `User`, all three roles) and POD display: real upload/preview/remove reusing the POD Cloudinary path, admin photo moderation, the rider's avatar narrowed onto authenticated tracking only, a POD thumbnail replacing the "View the photo" link, honest OTP-proof copy, an accurate rider-card sublabel on terminal deliveries | Uploaded as each role, confirmed in the rail/profile/every table showing that person; rider avatar confirmed present on authenticated tracking and absent from the public payload by inspecting the actual response; a non-Cloudinary URL rejected server-side; merged via PR |
| M10 | Deploy + rehearse | Live on Vercel + Render + Atlas, demo data seeded, run-through twice |

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
