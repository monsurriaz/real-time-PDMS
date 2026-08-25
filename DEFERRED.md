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

Analytics, the state pass, the rider mobile pass, the scoping audit and design
debt are all in Resolved. What is left is what M6 stopped short of, and why.

| Item | Origin | Status |
|---|---|---|
| **Admin fleet map joins every active room** | M4 | **Deliberately not done in M6.** The change rewires socket room topology — a single `admin:fleet` room the server publishes to, instead of N joins — and live tracking is the flagship demo. At 20 active deliveries N joins costs nothing measurable, so this is real work with no demo-visible payoff, taken on immediately before M7's deploy and rehearsal. Do it after the demo, or not at all. |
| Zone base differentiation | M2 | Untouched. All zones still seed at `baseFare: 0` so the ৳126 example reproduces exactly. One-line seed change whenever demo texture matters more than the documented example. |
| **Tier price monotonicity unvalidated** | M5 | Untouched. Tiers are validated ascending and non-overlapping as CLAUDE.md requires, but an admin could still configure a formula tier that prices a heavier parcel cheaper than a lighter one. A unit test asserts the seeded ladder is monotonic; the editor would accept an inverted one. |
| **Payment does not gate the lifecycle** | M5 | Untouched, and still deliberate: a card parcel can reach `Delivered` with payment `pending`. Making prepayment mandatory means a new precondition in `advanceStatus`, decided on purpose. |
| No refund path | M5 | Untouched. A prepaid parcel cancelled after payment keeps `status: 'paid'`; `refunded` exists in the enum and nothing sets it. |
| A settlement cannot be corrected | M5 | Untouched. Settling is one-way from the UI; the fix is a counter-entry, not an edit, since the trail is append-only by design. |
| COD parcels never collect the delivery fee | M5 | Untouched. The ledger tracks `codAmount` at the door and the `price.total` fee is not collected anywhere. Modelling gap, internally consistent. |
| Webhook is acknowledged before the ledger write | M5 | Untouched, and still the right trade: the provider never waits on our database, and a dropped event is recoverable by resending from the dashboard. |
| Proof photos are never deleted from Cloudinary | M5 | Untouched. The preset is unsigned and no API secret is in `.env`, so the server cannot delete. |
| HEIC photos may not compress | M5 | Untouched. Falls back to an honest error and the rider uses OTP or signature. Worth one test on a real iPhone before the demo. |
| No admin unassign | M3 | Untouched, and explicitly out of scope for M6: it would add a lifecycle transition, which is a decision to take deliberately rather than as part of a polish pass. |

---

## M6.5b / M6.5c — the rest of the v3 rebuild

M6.5a did foundations, routes, the shell and the screens that already existed.
These are the pieces it deliberately stopped before.

| Item | Target | Notes |
|---|---|---|
| **Landing page at `/`** | M6.5c | `/` currently forwards a signed-in visitor to their role default. v3 says it should show the public page with a link to the dashboard instead — a signed-in person is still allowed to read the marketing copy. That needs copy to exist, so `LandingPlaceholder` is replaced rather than edited. |
| Sign-up and the approval flow | M6.5c | `/signup`, `/agent/pending`, `/admin/agents`. The rail's Riders item is dimmed and its pending count is already wired — it reads 0 because no rider carries an approval field yet, which is the honest answer until the flow exists. |
| Profiles | M6.5c | `/customer/profile`, `/agent/profile`, `/admin/profile`. The account menu's Profile item is present and disabled, and now says when it's arriving (M6.5b) rather than just refusing. |
| **Public tracking by tracking ID** | M6.5c | v3's route table has `/track/:trackingId` as PUBLIC — track without logging in. Today `/track/:parcelId` redirects to the customer screen, which needs a session. The public version needs an unauthenticated lookup endpoint, which is server work this session was scoped out of. |
| Search field | M6.5c | Presentational. A real input, disabled, labelled "coming in M6.5c" rather than a decorative box that swallows keystrokes. Wiring it means a server search across tracking IDs, customers and riders. |
| Notification bell | M6.5c | Presentational and disabled. There is no notification store; v3 draws an unread dot, and showing one over nothing would be a lie. |
| Zones nav item | M6.5c | v3's admin rail has Operations / Analytics / COD, then Riders / Pricing / **Zones**. Zones has no screen and no count, so it is omitted rather than dimmed — an empty row for a screen nobody has asked for is noise. |

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
| positron stays as the tile style, recoloured in code | Deliberate, and measured. v3's map ground is cool (#E9ECF1); OpenFreeMap's positron is rgb(242,243,240) and bright/liberty are #F8F4F0, all warm, and fiord is a dark style which v3 rules out. positron is the closest to neutral and the one CLAUDE.md names, so `lib/mapStyle.ts` shifts its greys onto the cool axis after load. Same tiles, same URL, same free tier. |
| The rail's counts mean "needs attention", not "how many exist" | Deliberate, and it is v3's stated reason for the rail carrying counts at all. My parcels counts parcels still moving, not everything ever sent; COD counts riders holding cash, not the amount. |
| Table headers and `.who` sub-lines use `--muted`, where v3 specifies `--faint` | Deliberate. Measured: `--faint` on `--surface` is 2.62:1. A column header is content — it is what tells a reader what the column means. `--muted` is 4.83:1 and comes from the same palette, so this narrows which token is used rather than inventing one. Decorative `--faint` (placeholders, "flat" hints) is untouched. |
| The rail's group headings and counts use `--chrome-muted`, where v3 specifies `--chrome-faint` | Same reasoning: 3.04:1 against 5.24:1, and v3's own note says the counts are the reason the rail exists. |
| The zone chart is single-hue, not a status-coloured stacked bar | Deliberate. The lifecycle ramp fails as an adjacent categorical set — transit orange against failed red is ΔE 8.7 for normal vision, and orange against delivered green is 5.9 under protanopia. The palette is frozen, so the form changed instead: ink for completed, a recessive track for open, every number direct-labelled. |
| Analytics reads through `find()` rather than an aggregation | Deliberate. `$lookup`/`$match` bypass the roleScope query middleware entirely. The figures are counted in JavaScript inside `runAsSystem`, where "unscoped" is stated rather than accidental. Revisit only if the collection outgrows a course demo. |
| `PROMISED_WINDOW_HOURS = 24` lives in one constant, not in config | Deliberate for now. CLAUDE.md states no service level; one named constant in `lifecycle.ts` is the honest version of "not decided yet". If the promise ever varies by zone or weight it belongs in `PricingConfig` beside the rates. |
| Analytics keys zone performance off the DROP zone | Deliberate, and the opposite of pricing, which keys off PICKUP. Different questions: pricing asks what it costs to get a rider to the parcel; performance asks where parcels are being taken. |
| A COD parcel is booked without any checkout step | Deliberate. There is nothing to pay online; `POST /payments/.../checkout` refuses a COD parcel outright rather than creating a session nobody should complete. |
| Rider disabled controls at 2.36:1 (Call/Navigate) | Decided during the M6.5b rebuild, per the note that raised it: WCAG 1.4.3 exempts text in an inactive component, and these two literally do nothing yet (CLAUDE.md section 7 keeps the recipient's number and drop coordinates off this payload) — no information is lost by them being hard to read outdoors, unlike the Eyebrow case where `--ink-2` replaced `--faint` for text a rider needs at all times. Left on the shared `Button` disabled style rather than given a rider-only override. |
| The Shift rail popover is `fixed`, not anchored to the 216px rail | Deliberate. Below 768px the rail collapses to a 64px icon strip (a pre-existing, all-roles convention — see AppShell), and the location form's zone select and two coordinate fields cannot fit anchored to that box without being clipped. `fixed` positioning lets one trigger and one editor (`ShiftEditor`) work at every width instead of the phone needing a second copy of the control. |
| The run queue includes the CURRENT delivery, not just the ones behind it | Deliberate, and the reason it isn't called "Up next" the way the static reference labels it: when it is also how a rider switches which parcel is on the left, the selected one has to be in the list, highlighted, or there is nothing to click back to. |
| `/agent/runs/:id` for an id that isn't (or is no longer) one of the rider's active runs | Falls back to the first active run rather than 404ing. A rider is never looking at nothing just because a bookmark outlived the delivery it named; there is no dedicated detail view a finished run's id could point to instead. |

---

## Resolved

| Item | Milestone | Commit |
|---|---|---|
| **Rider workspace rebuild** — route map beside the active delivery, `/agent/runs/:id`, shift folded into the rail | M6.5b | `PENDING` |
| `/agent/finished` | M6.5b | `PENDING` |
| Seed leaves settlement records behind | M6.5b | `09ba383` |
| Sidebar account block scrolled away with the page instead of staying pinned | M6.5b | `a82f3c3` |
| Account menu's Profile item disabled with no explanation | M6.5b | `b86f049` |
| Disabled buttons were a washed-out accent ("Mark delivered") | M6.5a | `b16ad74` |
| Primary button contrast — v3's accent is 5.89:1 on white, against v1's 3.75:1 | M6.5a | `b16ad74` |
| Topbar wordmark as a 26px target — the header shell is gone; the rail's is 37-46px | M6.5a | `b16ad74` |
| **Socket room authorisation bypass** (agents could join any parcel room) | M6 | `cd8904f` |
| `roleScope` merged with `Query.where`, so same-key filters overwrote | M6 | `cd8904f` |
| Admin analytics: stat cards, zone chart, delayed alerts, revenue | M6 | `cd8904f` |
| Loading / empty / error pass across every screen | M6 | `cd8904f` |
| Agent mobile pass: 15 undersized tap targets → 1, 21 contrast failures → 4 | M6 | `cd8904f` |
| `expectedBy` never set on real bookings, so nothing could be late | M6 | `cd8904f` |
| Design debt: `rounded-[2px]`, `text-[13.5px]`, `text-[14.5px]` | M6 | `ced8989` |
| `.b-cancelled` badge variant now exists by name | M6 | `ced8989` |
| Map bundle weight — MapLibre split out, 1,571 kB → 755 kB | M6 | `ced8989` |
| `advanceStatus` enforced structurally, not by convention | M6 | `ced8989` |
| Route geometry cache had no TTL | M6 | `ced8989` |
| Rider marker hidden under the pickup pin | M6 | `ced8989` |
| Assignment ignored rider workload | M6 | `ced8989` |
| **Weight cap gap** (pulled forward from M6) | M5 | `b31345f` |
| Real proof-of-delivery capture | M5 | `b31345f` |
| Rehearsal check: weight cap (M7) — moot, 20 kg now prices | M5 | `b31345f` |
| react-router-dom v6 → v7 (2 moderate advisories) | M1 | `3bd0b92` |
| Optional GeoJSON points materializing as empty arrays | M1 | — |
| `runAsSystem` receiving un-executed Mongoose Query | M1 | — |
| Atlas password rotation after plaintext exposure | M1 | — |
