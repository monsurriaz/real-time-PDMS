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

Nothing outstanding. The two items that were here — real POD capture, and the
weight cap pulled forward from M6 — are in Resolved.

---

## M6 — Analytics + polish

| Item | Origin | Notes |
|---|---|---|
| Design debt: arbitrary values | M1 | `rounded-[2px]` on the wordmark dot, `text-[13.5px]`, `text-[14.5px]` aren't backed by tokens. Rule 1 covers radius and font, not just spacing. Cosmetic only. Sweep once, after every screen exists. |
| `.b-cancelled` badge variant | M2 | Design system defines six badge variants for seven lifecycle states. Cancelled currently borrows Booked's neutral grey — correct behaviour, but the variant should exist by name. |
| Zone base differentiation | M2 | All zones seeded at `baseFare: 0` so the ৳126 documented example reproduces exactly. Consider giving zones distinct bases for demo texture — one-line seed change. |
| Assignment ignores rider workload | M3 | `$near` filters on `status: 'available'` only, so one rider can hold unlimited `Assigned` parcels before picking any up. Availability flips at `PickedUp`, not `Assigned`, which is deliberate — but a cap or a load-aware tiebreak would spread work more realistically. |
| Map bundle weight | M4 | MapLibre pushes the client bundle to ~1.5 MB (403 KB gzipped) from ~500 KB. Fine on a laptop, slow on a rider's phone over 3G. Fix by lazy-importing `TrackingMap` behind `React.lazy` so only tracking screens pay for it. |
| Route geometry has no TTL | M4 | `RouteCache.geometry` is written once and never refreshed, so a changed road layout would keep serving the old line. Harmless for a seven-day project; a `lookedUpAt` age check would fix it. |
| Rider marker hidden under the pickup pin | M4 | When a rider is parked at the pickup point the ink pickup pin draws over the orange rider dot, so the rider looks black. Cosmetic; a small offset or a z-order rule fixes it. |
| Admin fleet map joins every active room | M4 | With 20 active deliveries the admin socket joins 20 rooms individually. Works, but a single `admin:fleet` room the server publishes to would scale better than N joins. |
| `advanceStatus` is the only status path **by convention** | M3.5 | Nothing writes `delivery.status` outside `advanceStatus()` today, but `DeliveryModel` is exported and importable — any future route could `$set: { status }` and bypass the state machine entirely. CLAUDE.md §5 says "no route mutates status directly"; that is currently discipline, not enforcement. Options: a Mongoose pre-hook rejecting `status` writes that lack an internal marker, or moving the model behind a repository that exposes no status setter. |
| No admin unassign | M3 | An admin can reassign a delivery but cannot return it to `Booked`/unassigned. Not in CLAUDE.md §5's lifecycle, so adding it means adding a transition — decide deliberately rather than by accident. |
| **Tier price monotonicity unvalidated** | M5 | Tiers are validated ascending and non-overlapping, exactly as CLAUDE.md §5 requires — but nothing stops an admin configuring a formula tier that prices a heavier parcel *cheaper* than a lighter one (a low `baseFee` on a tier above a high flat one). The seeded ladder is continuous and a unit test asserts monotonicity across it; the editor would accept an inverted one. A cross-boundary check on save would close it. |
| **Payment does not gate the lifecycle** | M5 | A card parcel can reach `Delivered` with its payment still `pending` — deliberate, because M3's state machine owns Delivered's preconditions and a slow webhook must not be able to strand a parcel mid-demo. If prepayment should be mandatory that is a new precondition in `advanceStatus`, decided on purpose rather than by drift. |
| No refund path | M5 | A prepaid parcel cancelled after payment keeps `status: 'paid'`; the `refunded` state exists in the enum and nothing ever sets it. Needs a provider refund call plus a `Cancelled`-after-`paid` branch in the COD/lifecycle sync. |
| A settlement cannot be corrected | M5 | Marking a rider settled is one-way from the UI. The audit trail is append-only by design, so the fix is a counter-entry (a negative settlement, or a `reversedBy` field), not an edit — worth deciding before someone mis-taps during the demo. |
| COD parcels never collect the delivery fee | M5 | For a COD parcel the ledger tracks `codAmount` (the sender's stated amount, collected at the door) and the `price.total` delivery fee is not collected anywhere. Real operators add the fee to the collected amount. Modelling gap, not a bug — the numbers on screen are all internally consistent. |
| `roleScope` merges with `Query.where`, so same-key filters overwrite | M5 | Two conditions on one path do not AND — the later wins. Found live: a rider requesting `GET /payments/settlements?agentId=<someone else>` got *their own* trail back rather than nothing. Fail-safe but misleading, and fixed locally in `settlementHistory` by honouring the filter for admins only. Any future handler filtering on a scoped key (`customer`, `agent`, `collectedBy`) has the same trap; a plugin that wrapped its condition in `$and` would fix it once. |
| Webhook is acknowledged before the ledger write | M5 | `POST /payments/webhook` verifies, replies 200, and applies the event in the background — so the provider is never waiting on our database. A crash in that window drops the event; recovery is resending it from the Stripe dashboard, which is idempotent. Awaiting the write instead would trade dropped events for retry storms on a slow connection. |
| Proof photos are never deleted from Cloudinary | M5 | The upload preset is unsigned and no API secret is in `.env`, so the server cannot delete. Fine for a course project; a real retention policy needs signed uploads. |
| HEIC photos may not compress | M5 | Client-side compression decodes through `createImageBitmap` with an `<img>` fallback; a browser that can do neither for HEIC surfaces an honest error and the rider can use OTP or signature instead. No silent failure, but iPhone-default HEIC is worth testing on a real device before the demo. |

---

## M7 — Deploy + rehearse

| Item | Origin | Notes |
|---|---|---|
| **Narrow Atlas network access** | M1 | Currently `0.0.0.0/0`. Acceptable for development; narrow to Render's egress range before final deploy if practical. |
| Rehearsal check: **the OTP channel** | M5 | There is no SMS provider in the stack, so a delivery code reaches the recipient via the parcel owner's tracking screen and the server log — the sender reads it out. Fine as a stated substitution, but the demo needs two windows open (customer tracking + agent phone) for the OTP path to look sensible. Decide whether to demo OTP or lead with photo proof. |
| Delivery codes are stored as typed, not hashed | M5 | `delivery.podOtp` holds the code (`select: false`, cleared on use, 10-minute expiry, 5 attempts) because with no SMS channel the server itself has to be able to show it to the parcel's owner. The *proof* record keeps only a timestamp, so nothing replayable survives a verification. Hash it the moment a real SMS provider exists. |

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
| No `stripe` npm package — REST + `node:crypto` HMAC instead | Deliberate. CLAUDE.md forbids adding a dependency without asking, and the two things the SDK would provide (form encoding, signature verification) are ~40 lines and covered by 11 unit tests. The API version is pinned by hand in `lib/payments/stripe.ts`. |
| The delivery code goes to the parcel's OWNER, never the rider | Deliberate. The rider is the party OTP proof exists to check; a code visible on the rider's screen makes the proof worth no more than their word. The server decides this by role, not by scoping. |
| POD photo uploads go browser → Cloudinary, not through our server | Deliberate, and what the unsigned preset in CLAUDE.md §2 implies. The server holds no API secret and verifies that a submitted URL names our own cloud — a 175 KB image left the phone and a 184-byte record reached Mongo. |
| `Payment.amount` means two different sums | Deliberate. COD tracks the cash at the door (`codAmount`), card tracks the delivery fee (`price.total`). Two payers, two amounts, one field — resolved once in `amountFor()` rather than at each call site. |
| A COD parcel is booked without any checkout step | Deliberate. There is nothing to pay online; `POST /payments/.../checkout` refuses a COD parcel outright rather than creating a session nobody should complete. |

---

## Resolved

| Item | Milestone | Commit |
|---|---|---|
| **Weight cap gap** (pulled forward from M6) | M5 | `PENDING` |
| Real proof-of-delivery capture | M5 | `PENDING` |
| Rehearsal check: weight cap (M7) — moot, 20 kg now prices | M5 | `PENDING` |
| react-router-dom v6 → v7 (2 moderate advisories) | M1 | `3bd0b92` |
| Optional GeoJSON points materializing as empty arrays | M1 | — |
| `runAsSystem` receiving un-executed Mongoose Query | M1 | — |
| Atlas password rotation after plaintext exposure | M1 | — |
