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
| **Admin fleet map joins every active room** | M4 | **Deliberately not done in M6.** The change rewires socket room topology — a single `admin:fleet` room the server publishes to, instead of N joins — and live tracking is the flagship demo. At 20 active deliveries N joins costs nothing measurable, so this is real work with no demo-visible payoff, taken on immediately before the deploy and rehearsal milestone (M10). Do it after the demo, or not at all. |
| Zone base differentiation | M2 | Untouched. All zones still seed at `baseFare: 0` so the ৳126 example reproduces exactly. One-line seed change whenever demo texture matters more than the documented example. |
| **Tier price monotonicity unvalidated** | M5 | Untouched. Tiers are validated ascending and non-overlapping as CLAUDE.md requires, but an admin could still configure a formula tier that prices a heavier parcel cheaper than a lighter one. A unit test asserts the seeded ladder is monotonic; the editor would accept an inverted one. |
| **Payment does not gate the lifecycle** | M5 | Untouched, and still deliberate: a card parcel can reach `Delivered` with payment `pending`. Making prepayment mandatory means a new precondition in `advanceStatus`, decided on purpose. |
| No refund path | M5 | Untouched. A prepaid parcel cancelled after payment keeps `status: 'paid'`; `refunded` exists in the enum and nothing sets it. |
| A settlement cannot be corrected | M5 | Untouched. Settling is one-way from the UI; the fix is a counter-entry, not an edit, since the trail is append-only by design. |
| ~~COD parcels never collect the delivery fee~~ | M5 | **Resolved in M6.9**, as a side effect of closing the codAmount integrity gap. `codAmount` is now set from `price.total`, so the cash a rider collects at the door IS the delivery fee. See Resolved. |
| Webhook is acknowledged before the ledger write | M5 | Untouched, and still the right trade: the provider never waits on our database, and a dropped event is recoverable by resending from the dashboard. |
| Proof photos are never deleted from Cloudinary | M5 | Untouched. The preset is unsigned and no API secret is in `.env`, so the server cannot delete. |
| HEIC photos may not compress | M5 | Untouched. Falls back to an honest error and the rider uses OTP or signature. Worth one test on a real iPhone before the demo. |
| No admin unassign | M3 | Untouched, and explicitly out of scope for M6: it would add a lifecycle transition, which is a decision to take deliberately rather than as part of a polish pass. |

---

## M6.96 — UI corrections (v3.1 addendum)

| Item | Notes |
|---|---|
| **Header search wired on 4 screens, not every table** | `/customer/parcels`, `/admin/board`, `/admin/agents`, `/admin/customers` claim the header box via `useSearchable`. The rider's own `/agent/runs` run queue, `/agent/finished`, and admin's `/admin/cod` reconciliation table do not yet — the box shows its honest "nothing to search here" disabled state on those screens rather than a fake claim. Same one-line change as the four already done (`useSearchable('placeholder…')` plus a filter predicate in the existing `useMemo`) whenever those screens matter enough to justify the pass. |
| Notification subtitle omits the rider's name | The addendum's own mock shows one example as "Rakib Hasan · Dhanmondi" (agent + area); routes/notifications.ts reads only `parcel.drop.area`, skipping an Agent→User join to keep the route's first cut lean. Add `riderNames`-style lookup (see payments.ts's private helper of the same shape) if the extra context earns its cost. |
| Landing page now loads MapLibre for every visitor | Deliberate, not overlooked. The showcase card asked for the REAL map component, and `/track/:trackingId` already does the same unauthenticated-visitor-loads-MapLibre thing with no controversy — this extends that accepted pattern to the highest-traffic public page instead of introducing a new one. `LazyTrackingMap`'s Suspense boundary keeps the rest of the hero (nav, headline, stat band) rendering immediately regardless. Revisit only if real traffic makes the extra ~250 kB gz felt. |

---

## M6.97 — map regression fix + semantic page classes

| Item | Notes |
|---|---|
| **Rider position falls back to `Delivery.lastKnownLocation` only, never `Agent.currentLocation`** | Untouched, on purpose for now. Both fields are written together by the socket's persist handler in real operation, so they should never actually disagree — the mismatch that made the M6.97 bug visible was `scripts/seed.ts` (sets `Agent.currentLocation`) and `scripts/seed-parcels.ts` (sets `Delivery.lastKnownLocation`) fabricating two UNRELATED positions for the same seeded rider, not a runtime defect. There is a real, narrower gap this leaves open: the window between a fresh `Assigned` (before any GPS tick) and the first tick, where `lastKnownLocation` is null and the UI shows "waiting for the first position" even though `Agent.currentLocation` might hold a perfectly reasonable "last seen" position from the rider's PREVIOUS delivery. Reading it as a fallback in `useLiveTracking`, `useDeliveryRoute` and the two server tracking routes would close that window, at the cost of touching four call sites for a state that resolves itself within one real GPS tick anyway. |

---

## M6.98 — live board fixes

Nothing outstanding from the two scoped items (fleet map sourced from Agent, assign/reassign
as a modal). One extra fix landed in the same session, outside the original scope, at the
user's request after reviewing a screenshot:

| Item | Notes |
|---|---|
| **Shift rail popover covered the run detail card on wide viewports** | Was recorded above as deliberate (`fixed left-[220px]`, meant to clear the 216px rail) — but the offset only ever cleared the rail by ~4px, so on a desktop-width viewport the popover landed on top of `DeliveryDetail`'s map/status badge/`LifecycleRail` instead of beside them, hiding exactly the delivery status a rider opens Shift while still wanting to see. Rebuilt on the shared `Modal` (the same component the assign/reassign panel above uses) instead of a hand-positioned `fixed` box. That surfaced a second, sharper bug the same fix had to absorb: `AppShell`'s rail is `position: sticky`, which creates its own CSS stacking context regardless of z-index — a `fixed` element rendered from *inside* it (as `ShiftRail`'s popover was) paints as part of THAT context, under `<main>`'s content, no matter how high its z-index reads. Confirmed with `elementFromPoint`, not just visually: the map canvas was genuinely hit-testing above a `z-40` backdrop. `Modal` now renders via `createPortal` onto `document.body`, which fixes it for every current and future caller, not just this one. |

---

## M8 — offer/accept/decline lifecycle

| Item | Notes |
|---|---|
| Authenticated tracking's `events[]` can lag by one entry immediately after an on-read expiry | `GET /tracking/:parcelId` and `GET /deliveries/:id` both re-evaluate offer expiry before responding, but the in-memory `delivery.events` array they already loaded predates the "Offer expired" event `evaluateOfferExpiry` just pushed to the database — the STATUS in the response is correct (patched explicitly), but the event timeline for that one read is one entry behind. Self-heals on the very next read (nothing re-expires, the array comes back fresh). Left alone rather than re-querying `events` on every status-changed-by-expiry read, which would add a query to a path that's supposed to stay cheap for the common case (nothing expired). |
| No admin-visible flag that a Booked delivery already exhausted every eligible rider | Deliberate, per the M8 brief itself: "reuse the existing no-rider-available path, don't build a second." Opening Assign for a delivery every eligible rider has declined shows the same `strategy: 'none'` / "No available rider covers X" message the panel has always shown for an empty zone — an admin has to open Assign to see it, same as before M8, rather than a passive badge on the row. |

---

## M9 — recipient phone, messaging, agent suspension

| Item | Notes |
|---|---|
| Suspending an agent does not itself move their Assigned/Accepted deliveries anywhere | Deliberate, per the M9 brief's own instruction: "that's already legal (reassignment before PickedUp exists), so no new lifecycle transition is needed." An Accepted delivery cannot reach bare `Booked` in one hop anyway (`Accepted`'s legal moves are `PickedUp`/`Assigned`/`Cancelled` — see lifecycle.ts), so an automatic "return to the pool" would need either a new edge or a same-second auto-reassignment to a guessed replacement, both of which are more machinery than the brief asked for. The admin's existing Assign/Reassign action already works unchanged on a suspended rider's pre-pickup delivery — confirmed live against the demo database — and the suspended rider is excluded from being the one it lands on again. |
| Admin's read-only thread view is a second small Modal on the board, not folded into the existing Assign/Reassign one | The two are populated by mutually exclusive delivery states — Assign/Reassign only shows before `PickedUp`, a thread only ever has content from `PickedUp` on — so merging them would mean one Modal doing two unrelated jobs depending on which button opened it. Reuses the same `Modal` component and the same `MessageThread` participants render, just a separate trigger. |
| Message retention cap enforced with a count-then-delete pair, not `$push`/`$slice` | `Message` is its own collection (one document per message, matching Payment/Settlement's shape), not an embedded array on Delivery, so there is no single array to `$slice` atomically. Fine at this project's scale — the cap only ever prunes a handful of rows past 200 on an already-rare write path (one message send). |

---

## Post-M6.5 — open backlog, no milestone attached

M6.5a, b and c between them did every screen v3's route table names. These
three were never part of any of the three sessions' task lists — they stay
presentational, and now that M6.5 itself is closed there is no next v3
sub-session to pencil them into. Pick them up whenever the functionality
they need (server search, a notification store, a Zones screen) is worth
building for its own sake.

| Item | Notes |
|---|---|
| Search field | Presentational. A real input, disabled, now labelled "coming soon" — M6.9 dropped the stale M6.5c reference. Left unwired on purpose: the field lives in the shell and the rows live in each page, so even the cheap version (filtering already-fetched rows) needs a shell-to-page channel nothing else wants, and it would search one page of one table while looking global. Real search is a server lookup across tracking IDs, customers and riders. |
| Notification bell | Presentational and disabled. There is no notification store; v3 draws an unread dot, and showing one over nothing would be a lie. |
| Zones nav item | v3's admin rail has Operations / Analytics / COD, then Riders / Pricing / **Zones**. Zones has no screen and no count, so it is omitted rather than dimmed — an empty row for a screen nobody has asked for is noise. |
| **`scripts/` is outside every tsconfig** | Found in M6.9: `npm run typecheck` covers shared, server and client, and nothing covers `scripts/`. The seed edits that session made were never typechecked by the normal command — they were checked by hand with a throwaway config and were clean, but the gap is real and it is CLAUDE.md rule 4 with a hole in it. Fix is a `typecheck:scripts` entry pointing at a `scripts/tsconfig.json`; parked rather than added to root scripts immediately before the deploy milestone. |
| Legacy COD rows disagree with their own price | Found in M6.9. The invariant `codAmount === price.total` holds for every new booking and for everything the seed produces, but four rows already in the demo database predate it (three seeded, one hand-booked). `npm run seed` fixes the three; the hand-booked one is real user data. Harmless, and worth a re-seed before the rehearsal. |

---

## Post-course — not this project's scope

| Item | Origin | Notes |
|---|---|---|
| **Email verification / OTP by email** | M6.9 | Descoped on purpose, four days from the demo. It needs an outbound mail service (a provider account, a domain, a sender identity, deliverability that does not land in spam), which is a new external dependency and a new failure mode in the one path every account has to walk through. M6.9 shipped a one-time welcome instead — `User.welcomeSeenAt`, server-decided, no mail involved — which is what the flow was actually going to *use* the email for. Real verification is post-course work, not the deploy milestone (M10). |

---

## M10 — Deploy + rehearse

Renumbered from M7. M8 and M9 both landed ahead of it, per CLAUDE.md's own milestone table.

| Item | Origin | Notes |
|---|---|---|
| **Narrow Atlas network access** | M1 | Currently `0.0.0.0/0`. Acceptable for development; narrow to Render's egress range before final deploy if practical. |
| Rehearsal check: **the OTP channel** | M5 | There is no SMS provider in the stack, so a delivery code reaches the recipient via the parcel owner's tracking screen and the server log — the sender reads it out. Fine as a stated substitution, but the demo needs two windows open (customer tracking + agent phone) for the OTP path to look sensible. Decide whether to demo OTP or lead with photo proof. |
| Delivery codes are stored as typed, not hashed | M5 | `delivery.podOtp` holds the code (`select: false`, cleared on use, 10-minute expiry, 5 attempts) because with no SMS channel the server itself has to be able to show it to the parcel's owner. The *proof* record keeps only a timestamp, so nothing replayable survives a verification. Hash it the moment a real SMS provider exists. |

---

## No action — recorded so it isn't re-litigated

| Item | Decision |
|---|---|
| The landing hero drops its separate "Send a parcel" CTA button | Deliberate, M6.96. The v3.1 addendum's own corrected mock has no such button in the hero body — the nav's primary button already carries it, and the track-by-ID row takes the slot under the subcopy instead. Repeating the button twice on one screen was the kind of redundancy the addendum's own header-avatar note calls out elsewhere ("two doors to one room"). |
| The landing showcase's "completed vs remaining" split is computed by projection, not by drawing the raw GPS trail | Deliberate, M6.96 — see TrackingMap's own `splitRouteByProgress` comment for the full reasoning. The addendum's mock draws ONE road-snapped path that turns from solid to dashed at the rider's position, not a second, independently-sourced line laid over the planned route; a raw GPS trail (jittery, sparse, sometimes off-road) would not visually read as "the same route, cut at the rider" the way the mock shows. `useLiveTracking`'s `history`/`trail` accumulation stays — section 6 mandates the cap regardless of how it's rendered — but nothing feeds it into the map's line any more. |
| Header search's placeholder claim runs in a real hook, not a prop AppShell forwards | Deliberate, M6.96. Two admin pages (`AdminAgentsPage`, `AdminCustomersPage`) called `<AppShell>` directly from the same component that fetched their data, with the tables inline — meaning `useSearchable`, if called at that same level, would run BEFORE AppShell's context provider exists in the tree and silently see nothing. Both were split into a thin outer component plus an inner one actually rendered as AppShell's `children`, which is also where `ParcelList` and `DeliveryBoard` already lived. Get this wrong and the failure is silent (the box just never claims a placeholder) rather than a crash — worth documenting precisely because it's easy to reintroduce on a future screen. |
| `--space-8` (32px), `--space-10` (40px) unused | Harmless headroom. Unused tokens in a scale aren't drift. |
| Zone base sourced from **pickup**, not drop | Deliberate. "Getting a rider to the parcel" is the right model, and it matches how assignment keys off pickup location. |
| Cancelled reuses Booked's grey, not Failed's red | Deliberate. A cancelled parcel is inert, not failed; red would misreport it. |
| `Block C, Bashundhara R/A` not in OSM | Substituted `Block B, Bashundhara Residential Area` (90.4282, 23.8144) after testing four alternatives. |
| `priceFor()` async wrapper around pure `computePrice()` | Correct shape. Resolving a zoneId needs a DB read; the pure function stays testable. |
| Spacing scale includes off-grid intermediate steps | Deliberate, so the frozen HTML stays pixel-exact and the scale stays authoritative. |
| No `stripe` npm package — REST + `node:crypto` HMAC instead | Deliberate. CLAUDE.md forbids adding a dependency without asking, and the two things the SDK would provide (form encoding, signature verification) are ~40 lines and covered by 11 unit tests. The API version is pinned by hand in `lib/payments/stripe.ts`. |
| The delivery code goes to the parcel's OWNER, never the rider | Deliberate. The rider is the party OTP proof exists to check; a code visible on the rider's screen makes the proof worth no more than their word. The server decides this by role, not by scoping. |
| POD photo uploads go browser → Cloudinary, not through our server | Deliberate, and what the unsigned preset in CLAUDE.md §2 implies. The server holds no API secret and verifies that a submitted URL names our own cloud — a 175 KB image left the phone and a 184-byte record reached Mongo. |
| `Payment.amount` means two different sums | Was deliberate; **no longer true as of M6.9**. `codAmount` is now the price snapshot, so COD and card resolve to the same figure. `amountFor()` and the two fields are kept anyway — they answer different questions ("what was this priced at" vs "what is the rider holding"), and a COD surcharge would separate them again without touching a call site. |
| positron stays as the tile style, recoloured in code | Deliberate, and measured. v3's map ground is cool (#E9ECF1); OpenFreeMap's positron is rgb(242,243,240) and bright/liberty are #F8F4F0, all warm, and fiord is a dark style which v3 rules out. positron is the closest to neutral and the one CLAUDE.md names, so `lib/mapStyle.ts` shifts its greys onto the cool axis after load. Same tiles, same URL, same free tier. |
| The rail's counts mean "needs attention", not "how many exist" | Deliberate, and it is v3's stated reason for the rail carrying counts at all. My parcels counts parcels still moving, not everything ever sent; COD counts riders holding cash, not the amount. |
| Table headers and `.who` sub-lines use `--muted`, where v3 specifies `--faint` | Deliberate. Measured: `--faint` on `--surface` is 2.62:1. A column header is content — it is what tells a reader what the column means. `--muted` is 4.83:1 and comes from the same palette, so this narrows which token is used rather than inventing one. Decorative `--faint` (placeholders, "flat" hints) is untouched. |
| The rail's group headings and counts use `--chrome-muted`, where v3 specifies `--chrome-faint` | Same reasoning: 3.04:1 against 5.24:1, and v3's own note says the counts are the reason the rail exists. |
| The zone chart is single-hue, not a status-coloured stacked bar | Deliberate. The lifecycle ramp fails as an adjacent categorical set — transit orange against failed red is ΔE 8.7 for normal vision, and orange against delivered green is 5.9 under protanopia. The palette is frozen, so the form changed instead: ink for completed, a recessive track for open, every number direct-labelled. |
| Analytics reads through `find()` rather than an aggregation | Deliberate. `$lookup`/`$match` bypass the roleScope query middleware entirely. The figures are counted in JavaScript inside `runAsSystem`, where "unscoped" is stated rather than accidental. Revisit only if the collection outgrows a course demo. |
| `PROMISED_WINDOW_HOURS = 24` lives in one constant, not in config | Deliberate for now. CLAUDE.md states no service level; one named constant in `lifecycle.ts` is the honest version of "not decided yet". If the promise ever varies by zone or weight it belongs in `PricingConfig` beside the rates. |
| Analytics keys zone performance off the DROP zone | Deliberate, and the opposite of pricing, which keys off PICKUP. Different questions: pricing asks what it costs to get a rider to the parcel; performance asks where parcels are being taken. |
| A COD parcel is booked without any checkout step | Deliberate. There is nothing to pay online; `POST /payments/.../checkout` refuses a COD parcel outright rather than creating a session nobody should complete. |
| The run queue includes the CURRENT delivery, not just the ones behind it | Deliberate, and the reason it isn't called "Up next" the way the static reference labels it: when it is also how a rider switches which parcel is on the left, the selected one has to be in the list, highlighted, or there is nothing to click back to. |
| `/agent/runs/:id` for an id that isn't (or is no longer) one of the rider's active runs | Falls back to the first active run rather than 404ing. A rider is never looking at nothing just because a bookmark outlived the delivery it named; there is no dedicated detail view a finished run's id could point to instead. |
| `/track/:id` serves the pre-v3 `/track/:parcelId` redirect AND v3's new public `/track/:trackingId` at the same route | They are the identical path shape — react-router has no way to prefer one over the other by param name — so one component decides by shape: a 24-char hex id (a Mongo ObjectId) redirects to `/customer/track/:id` the way it always did; anything else is treated as a real tracking ID and hits the new public lookup. `PD-XXXX-XX` can never collide with 24 hex characters. |
| Public tracking (`/track/:trackingId`) withholds recipient name/phone, street addresses, weight, price, COD amount, and event notes | Deliberate, and stricter than the authenticated customer view — see `publicTrackingSnapshotSchema`'s own note. A stranger with a tracking ID gets enough to answer "where is it", not the parcel's contents or who is receiving it. `point` is also null whenever no agent is assigned, even if `lastKnownLocation` happens to hold a stray value (seeded demo data can), because this field means "the rider's position" and there is no rider to mean it. |
| Rider details (profile) absorbs `ShiftEditor` rather than a second implementation | The same component now renders in two places — the rail's popover and the profile's "Rider details" tab — which is what "absorbs... don't duplicate" asked for. Vehicle and covered zones are new fields the profile adds; status and location stay exactly the form M6.5b built. |
| Rider details / signup keep "zone covered" as a single select, not a multi-select | Signup only ever collects one "preferred zone", and `Agent.zones` is a list mostly so a rider can be asked to cover more later — no UI in this build has ever needed to pick more than one at a time, so a multi-select control was not built just to sit unused. Editing writes a one-element array. |
| Saved addresses (customer profile) are CRUD only, not wired into booking's autofill | The tab lets a customer create, list and remove addresses; BookParcelPage still asks for pickup/drop by hand. Autofill is real, separate work — reading a saved address into the booking form's fields — parked here rather than rushed into this session. |
| "Change photo" stays a disabled button, not a real upload | Consistent with `Table.tsx`'s own reasoning for the plain-circle `Avatar`: there are no uploaded profile images anywhere in this build, and a generated initial would imply an identity the record does not carry. Photo upload was never asked for; the button exists because v3 draws it, and disabling it says so honestly rather than omitting a control the reference shows. |
| Seed now has 5 agents, not the 4 CLAUDE.md section 9 names | The brief for this session asked for exactly this: "add one pending agent so the approval queue isn't empty on a fresh seed." The four original (2 available, 1 on delivery, 1 offline) are unchanged; a fifth, pending, sits alongside them. |
| `VITE_SHOW_DEMO_LOGINS` defaults to shown, not hidden | The login screen's demo panel is gated "so an examiner isn't hunting for credentials" — which only holds if it is ON by default for the course demo. The flag exists to turn it OFF for a hypothetical real deploy, not to require opting in during the one context (grading) this project actually runs in. |
| Both booking paths use one URL and one query shape (`?payment=success`) | Deliberate, M6.9. `payment=success` only ever meant "the customer got through the form" — a COD parcel was never paid at all, and a card payment is unconfirmed until the webhook lands. Rather than a second param shape for COD, the banner reads the parcel's ACTUAL state and picks its own copy. One destination, one implementation of "did that work?". |
| `User.status` replaced `isActive` rather than joining it | Deliberate, M6.9. Two fields for one fact is worse than one, the enum names the states, and the old boolean was only ever read at login — which was the bug. `suspended` is reversible, unlike an agent's terminal `rejected`. |
| The one-time welcome flag lives on `User`, not `Agent` | Deliberate, M6.9, and a stated deviation from the brief's "firstLoginAt on Agent". Registration signs a rider in while their application is pending, so a flag stamped at first login is spent on /agent/pending and the approval notice never fires. `welcomeSeenAt` is written only when a notice is actually shown, which makes "first login after approval" true for a rider and "first login" true for a customer from one field. |
| A missing `status` / `accountHistory` reads as active / empty | Deliberate, M6.9. `.lean()` applies no schema default, so accounts predating these fields come back without them. Absent means active: the field was added to take a capability away, and defaulting the other way would have locked every existing account out of its own session. `_id` is selected alongside so "no such user" (401) stays distinguishable from "no status yet" (pass). |
| `/admin/customers` is not in v3's route table | Deliberate, M6.9. Customer suspension did not exist when the reference was drawn. Nothing new was invented for the screen — filter bar, avatar rows, per-row action and pager are the components /admin/agents already uses — so it belongs to the frozen system rather than sitting beside it. Its rail item carries no count: a suspended account needs no attention, an admin suspended it on purpose. |
| Suspension is checked on socket CONNECT, not per event | Deliberate, M6.9, and named rather than hidden. A live socket held by an account suspended mid-stream survives until it reconnects. Closing it would mean watching the collection or re-reading the user on every GPS tick, and section 6's whole point is that ticks do not touch Mongo. |
| Rejected is terminal — no un-reject in this build | Same reasoning DEFERRED.md already records for "no admin unassign": reinstating a rejected application is a decision to take on purpose, not a status enum offering it by default. |
| The agent-approval decision buttons match the HTML exactly: Reject is quiet, Approve is ink | Not both ink. CLAUDE.md's own prose paraphrase groups them against "not accent"; the frozen HTML — which wins on any disagreement per rule 2 — draws only Approve as `.btn-ink`. |

---

## Resolved

| Item | Milestone | Commit |
|---|---|---|
| **`delivery.excludedAgents.map(...)` crashed on any pre-M8 delivery** — `GET /deliveries/:id/candidates` and `assignDelivery` both read this field with no fallback; `.lean()` skips the schema default, so a delivery created before M8 added `excludedAgents` comes back with the field simply absent, not `[]`, and every currently-`Assigned` delivery in the live demo database predates M8. Found while verifying M9's suspension work — reassigning a suspended rider's outstanding offer 500'd on every real delivery there was to test it against. Fixed with `(delivery.excludedAgents ?? []).map(...)` in both places, the same "absent means the pre-field default" reading every other `.lean()` call in this codebase already gives a missing field. | M9 | — |
| **Rider Call/Navigate, no longer disabled controls** — CLAUDE.md section 7's recipient-phone rule was narrowed rather than left in place: the number now reaches the CURRENTLY assigned rider only, and only while the delivery is non-terminal (routes/deliveries.ts's `toListItems`), so Call is a real `tel:` link. Navigate still needs drop coordinates, which the payload still withholds, and stayed dead controls are worse than absent ones (the header-avatar reasoning) — so it's removed outright instead of kept disabled. The 2.36:1-contrast entry this replaces no longer describes reality: there is one control here now, and it works. | M9 | — |
| **Map WebGL-unavailable crash** — a WebGL-less browser threw synchronously out of `new maplibregl.Map(...)`, before there was a map to attach the existing `on('error')` handler to; React 18 unmounts the whole tree on an uncaught render-phase error, so the failure was a blank page everywhere a map sat, not the friendly "could not load" message the component's own comment says it should show. Fixed with a try/catch around construction. Found by screenshotting this session's own work in a WebGL-less headless browser — the same failure mode a real visitor with WebGL disabled would hit. | M6.96 | — |
| **Map z-index never actually applied, on every surface** — `.maplibregl-marker:has(.pdms-rider)` assumed MapLibre wraps a custom marker element in its OWN container div; it doesn't, it adds its classes straight onto the SAME element, so `.pdms-rider`/`.maplibregl-marker` were one node, not ancestor and descendant, and `:has()` could never match. z-index silently stayed `auto` on every marker on every screen, and whichever marker happened to insert into the DOM last won the visual stack. Fixed with plain compound selectors (`.maplibregl-marker.pdms-rider`, `.maplibregl-marker.pdms-pin`) — there's no wrapper to reach through in the first place. Confirmed via computed style (`auto` → `2`/`1`) and a live screenshot of a rider sitting exactly at pickup: full clean accent disc on top, no black dot showing through. | M6.97 | — |
| **A rider's marker could insert into the DOM before the map's own endpoints did** — the "riders, eased between positions" effect checked only `if (!m) return`, not `if (!m \|\| !ready.current) return` like its two sibling effects. `map.current` is assigned synchronously right after construction, before `'load'` fires, so on the very first render this effect could add the rider's marker ahead of pickup/drop — combined with the z-index bug above, later-inserted siblings (pickup, drop) painted over an already-placed rider whenever they coincided, which is exactly what a freshly-assigned or just-picked-up delivery looks like (rider parked at pickup). Fixed by matching the guard the other two effects already use. | M6.97 | — |
| **Socket handshake rejected every account with a missing `User.status`** — `user?.status === 'active'` returns `false` when `status` is `undefined`, which every account seeded before M6.9 is — meaning no pre-existing rider could ever get a live socket connection at all, `simulate.ts` included. Same class of bug M6.9 already fixed twice elsewhere (`middleware/auth.ts`, `routes/customers.ts`) and missed here. Fixed to `(user?.status ?? 'active') === 'active'`, matching the other two call sites. Found because it was blocking this session's own verification — `npm run simulate` failed with "socket refused: unauthorised" against a perfectly valid, active rider account. | M6.97 | — |
| **Semantic page classes** — every top-level route's outermost element carries `<role>-<screen>` (`admin-board`, `agent-run-detail`, …), enforced by `AppShell`/`AuthSplit` taking it as a required prop rather than an optional convention. All 20 routes in the table confirmed rendering their class in a live DOM, including the two components (`RiderWorkspace`, `TrackParcelPage`) that render `<AppShell>` from more than one branch. | M6.97 | — |
| **Footer**, public pages only — `PublicFooter`, full link set on `/login`/`/signup`/`/track/:id`, wordmark-only on `/` (its own nav already carries those links) | M6.96 | — |
| **Landing hero** — two-column grid, a live showcase card built from real `TrackingMap`/`Badge`/`LifecycleRail`, bordered stat band, ink-filled feature chips (accent on the first only), track-by-ID inline under the subcopy | M6.96 | — |
| **Login/signup split screen** — one `AuthSplit` shell, chrome-dark proposition panel + white form panel, collapses to a wordmark-only band below 860px | M6.96 | — |
| **Header search** — real client-side filtering via `useSearchable`/`HeaderSearchContext`, ⌘K/Ctrl+K focus, honest disabled state where nothing is claimed; wired on 4 screens (see backlog above for the rest) | M6.96 | — |
| **Header notifications** — `GET /notifications`, role-scoped through the ordinary `DeliveryModel.find()` + roleScope middleware (no `runAsSystem`), overdue alerts admin-only, unread dot from a client-side last-seen timestamp | M6.96 | — |
| **Header avatar removed** — the rail's own account menu was always the one place identity lived; the header's copy was dead weight | M6.96 | — |
| **`LifecycleRail` compact variant** — one continuous filled track for every table row, `full` unchanged for detail views/cards | M6.96 | — |
| **Payment / booking success redirect** — both paths land on `/customer/parcels?payment=success&parcel=:id`, banner reads the parcel's real state, URL cleaned on mount | M6.9 | — |
| **Customer account suspension** — `User.status`, `/admin/customers`, append-only `accountHistory`, checked in `requireAuth` on every request and on the socket handshake | M6.9 | — |
| **COD amount integrity gap** — a customer could declare what a rider must collect; `codAmount` is now set from the price snapshot and absent from the input schema | M6.9 | — |
| **One-time welcome** on first login (rider: after approval) — `User.welcomeSeenAt`, no mail service | M6.9 | — |
| Stale "coming in M6.5c" search placeholder | M6.9 | — |
| **Landing page at `/`** — dark hero, LifecycleRail as the hero graphic, real stat band from `GET /pricing/summary` | M6.5c | `8eabbc5` |
| Login rebuilt to v3 exactly — demo panel gated behind `VITE_SHOW_DEMO_LOGINS`, link to signup | M6.5c | `8eabbc5` |
| Signup — role picker, rider-specific fields, `registerInputSchema` discriminated union with no admin branch | M6.5c | `8eabbc5` |
| **Agent approval flow** — `approvalStatus` on Agent, `/agent/pending`, `/admin/agents` approval queue + roster, pending/rejected excluded from the assignment pool at the query level | M6.5c | `8eabbc5` |
| **Public tracking by tracking ID** (`/track/:trackingId`, no auth) | M6.5c | `8eabbc5` |
| Profiles for all three roles — shared Account/Password tabs, saved addresses, rider details absorbing `ShiftEditor` | M6.5c | `8eabbc5` |
| Seed adds one pending agent | M6.5c | `8eabbc5` |
| **Rider workspace rebuild** — route map beside the active delivery, `/agent/runs/:id`, shift folded into the rail | M6.5b | `9b4e696` |
| `/agent/finished` | M6.5b | `9b4e696` |
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
| Rehearsal check: weight cap (M10) — moot, 20 kg now prices | M5 | `b31345f` |
| react-router-dom v6 → v7 (2 moderate advisories) | M1 | `3bd0b92` |
| Optional GeoJSON points materializing as empty arrays | M1 | — |
| `runAsSystem` receiving un-executed Mongoose Query | M1 | — |
| Atlas password rotation after plaintext exposure | M1 | — |
