# DEFERRED.md — parked work

Things we consciously postponed, with the milestone they belong to and why they were
deferred. This is a backlog, not a constitution — CLAUDE.md holds the rules, this holds
the debt.

**How to use this file:**
- When you defer something during a milestone, append it here with a milestone target
  and a one-line reason. Don't fix it in the current session unless asked.
- At the start of M5, M6, and M7, read the matching section and confirm with me what's
  in scope before starting.
- When an item is resolved, move it to the Resolved section with its commit hash.

---

## M5 — POD + payments

| Item | Origin | Notes |
|---|---|---|
| Real proof-of-delivery capture | M3 | M3 enforces the precondition only; Delivered is blocked with a stub-satisfiable flag. Replace with real photo/OTP capture. |

---

## M6 — Analytics + polish

| Item | Origin | Notes |
|---|---|---|
| **Weight cap gap** | M2 | Tiers stop at 5 kg; a customer entering 8 kg gets a 422 with no path forward. Fix with a formula tier (e.g. 5–20 kg: ৳130 + ৳15/kg over 5) rather than a flat fee, so it's honest rather than arbitrary. **Highest-value item in this file** — it's a dead end a real user can hit. |
| Design debt: arbitrary values | M1 | `rounded-[2px]` on the wordmark dot, `text-[13.5px]`, `text-[14.5px]` aren't backed by tokens. Rule 1 covers radius and font, not just spacing. Cosmetic only. Sweep once, after every screen exists. |
| `.b-cancelled` badge variant | M2 | Design system defines six badge variants for seven lifecycle states. Cancelled currently borrows Booked's neutral grey — correct behaviour, but the variant should exist by name. |
| Zone base differentiation | M2 | All zones seeded at `baseFare: 0` so the ৳126 documented example reproduces exactly. Consider giving zones distinct bases for demo texture — one-line seed change. |
| Assignment ignores rider workload | M3 | `$near` filters on `status: 'available'` only, so one rider can hold unlimited `Assigned` parcels before picking any up. Availability flips at `PickedUp`, not `Assigned`, which is deliberate — but a cap or a load-aware tiebreak would spread work more realistically. |
| Map bundle weight | M4 | MapLibre pushes the client bundle to ~1.5 MB (403 KB gzipped) from ~500 KB. Fine on a laptop, slow on a rider's phone over 3G. Fix by lazy-importing `TrackingMap` behind `React.lazy` so only tracking screens pay for it. |
| Route geometry has no TTL | M4 | `RouteCache.geometry` is written once and never refreshed, so a changed road layout would keep serving the old line. Harmless for a seven-day project; a `lookedUpAt` age check would fix it. |
| Admin fleet map joins every active room | M4 | With 20 active deliveries the admin socket joins 20 rooms individually. Works, but a single `admin:fleet` room the server publishes to would scale better than N joins. |
| `advanceStatus` is the only status path **by convention** | M3.5 | Nothing writes `delivery.status` outside `advanceStatus()` today, but `DeliveryModel` is exported and importable — any future route could `$set: { status }` and bypass the state machine entirely. CLAUDE.md §5 says "no route mutates status directly"; that is currently discipline, not enforcement. Options: a Mongoose pre-hook rejecting `status` writes that lack an internal marker, or moving the model behind a repository that exposes no status setter. |
| No admin unassign | M3 | An admin can reassign a delivery but cannot return it to `Booked`/unassigned. Not in CLAUDE.md §5's lifecycle, so adding it means adding a transition — decide deliberately rather than by accident. |

---

## M7 — Deploy + rehearse

| Item | Origin | Notes |
|---|---|---|
| **Narrow Atlas network access** | M1 | Currently `0.0.0.0/0`. Acceptable for development; narrow to Render's egress range before final deploy if practical. |
| Rehearsal check: weight cap | M2 | If the M6 fix hasn't landed, make sure no demo booking uses >5 kg. A 422 during the live demo would be avoidable and embarrassing. |

---

## No action — recorded so it isn't re-litigated

| Item | Decision |
|---|---|
| `--space-8` (32px), `--space-10` (40px) unused | Harmless headroom. Unused tokens in a scale aren't drift. |
| Zone base sourced from **pickup**, not drop | Deliberate. "Getting a rider to the parcel" is the right model, and it matches how assignment keys off pickup location. |
| Cancelled reuses Booked's grey, not Failed's red | Deliberate. A cancelled parcel is inert, not failed; red would misreport it. |
| `Block C, Bashundhara R/A` not in OSM | Substituted `Block B, Bashundhara Residential Area` (90.4282, 23.8144) after testing four alternatives. |
| `priceFor()` async wrapper around pure `computePrice()` | Correct shape. Resolving a zoneId needs a DB read; the pure function stays testable. |
| Spacing scale includes off-grid intermediate steps | Deliberate, so the frozen HTML stays pixel-exact and the scale stays authoritative. |

---

## Resolved

| Item | Milestone | Commit |
|---|---|---|
| react-router-dom v6 → v7 (2 moderate advisories) | M1 | `3bd0b92` |
| Optional GeoJSON points materializing as empty arrays | M1 | — |
| `runAsSystem` receiving un-executed Mongoose Query | M1 | — |
| Atlas password rotation after plaintext exposure | M1 | — |
