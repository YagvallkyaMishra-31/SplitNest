# Decision Log — SplitNest (Shared Expenses App)

> Every significant architectural, design, or policy decision is recorded here
> with options considered and rationale.

---

## D-001: Backend Stack — Node.js + Express vs Python + FastAPI

**Date:** 2026-06-14
**Decision:** Node.js + Express

**Options considered:**
| Option | Pros | Cons |
|---|---|---|
| Node.js + Express | Same language (JS) front-to-back → fewer context switches for a single dev; massive ecosystem; easy deployment on Render/Railway; simpler to explain in a code review since intern knows JS from React | Less built-in type safety than Python+Pydantic |
| Python + FastAPI | Excellent type validation via Pydantic; auto-generated API docs; great for data-heavy CSV parsing | Two languages in the stack; Python deployment sometimes needs extra config; intern needs to context-switch between Python (backend) and JS (frontend) |

**Why Node.js:** Since the frontend is React (JavaScript), using Node.js means
the entire stack is one language. For a 45-minute code review where you need to
explain every line, minimizing language switches is a big win. Express is the
most common, well-documented Node framework — no magic, easy to trace.

---

## D-002: ORM / Migration Strategy — Prisma vs Drizzle vs Raw SQL

**Date:** 2026-06-14
**Decision:** Prisma

**Options considered:**
| Option | Pros | Cons |
|---|---|---|
| Prisma | Declarative schema in one file; auto-generates migrations; type-safe client; great docs; easy to explain ("this schema file IS the database") | Heavier dependency; less SQL control |
| Drizzle | Lighter, SQL-like API; good TypeScript support | Newer, less battle-tested; docs less comprehensive |
| Raw SQL migrations | Full control; no abstraction to explain | Manual migration management; error-prone; more boilerplate |

**Why Prisma:** The schema file serves as both documentation AND the migration
source. In a code review, you can point at `schema.prisma` and say "this IS
the database." Auto-generated migrations mean fewer mistakes. The Prisma Client
gives type-safe queries with no raw SQL string bugs.

---

## D-003: Auth Strategy — JWT vs Sessions

**Date:** 2026-06-14
**Decision:** JWT (stateless, stored in httpOnly cookies)

**Options considered:**
| Option | Pros | Cons |
|---|---|---|
| JWT in httpOnly cookie | Stateless — no server-side session store needed; works well with REST APIs; easy to deploy (no Redis/session store) | Token revocation is harder (acceptable for this scale) |
| Express sessions + session store | Simple, well-understood | Needs a session store (memory leaks in production, or needs Redis); more moving parts to explain |

**Why JWT:** Simpler deployment (no session store), works naturally with REST
APIs, and for a small app like this the tradeoff of harder token revocation is
irrelevant. We'll use short-lived tokens (24h) stored in httpOnly cookies
(not localStorage — avoids XSS).

---

## D-004: Deployment Target

**Date:** 2026-06-14
**Decision:** Render (backend + PostgreSQL) + Vercel (frontend)

**Rationale:** Render offers free PostgreSQL databases and easy Node.js
deployment with zero config. Vercel is purpose-built for React frontends with
free tier. Both have generous free tiers and simple GitHub-connected deploys.
Alternative considered: Railway (good but credit-based free tier expires).

---

## D-005: Currency Conversion — Fixed Rate

**Date:** 2026-06-14
**Decision:** Fixed rate of 83.00 INR per 1 USD

**Rationale:** The CSV contains Goa trip expenses in USD (March 2026 timeframe).
Rather than calling a live FX API (which introduces non-reproducibility and
a network dependency), we use a fixed, documented rate. 83 INR/USD is a
reasonable approximation for early 2026 rates. This rate is stored as a
named constant in code, easily changeable. Both original (USD) and converted
(INR) amounts are stored on each expense record for full traceability.

---

## D-006: Rounding Policy — With Concrete Worked Examples

**Date:** 2026-06-14  
**Decision:** Round all monetary amounts to 2 decimal places (paise). When an
equal split produces a remainder, the payer absorbs the extra paise.

**Algorithm (implemented in the split engine):**
1. Convert total to paise: `total_paise = Math.round(amount * 100)`
2. Compute base share: `base = Math.floor(total_paise / n)`
3. Compute remainder: `remainder = total_paise - (base * n)`
4. Every participant gets `base / 100` rupees
5. Distribute `remainder` extra paise one-at-a-time, starting with the payer

**Concrete example 1 — Row 9: "Movie night snacks" (₹640 ÷ 3)**
- Total: ₹640.00, Participants: Aisha, Rohan, Priya (3 people), Payer: Priya
- In paise: 64,000 ÷ 3 = 21,333.33 → floor = 21,333 paise = ₹213.33
- Remainder: 64,000 − (21,333 × 3) = 64,000 − 63,999 = **1 paisa**
- Payer (Priya) absorbs the remainder:

| Participant | Share (₹) | Notes |
|-------------|-----------|-------|
| Aisha       | 213.33    | base share |
| Rohan       | 213.33    | base share |
| Priya (payer) | 213.34 | base share + 0.01 remainder |
| **Total**   | **640.00** | ✓ Sum matches exactly. No money created or destroyed. |

**Concrete example 2 — Row 37: "Wifi bill Apr" (₹1,199 ÷ 3)**
- In paise: 119,900 ÷ 3 = 39,966.67 → floor = 39,966 paise = ₹399.66
- Remainder: 119,900 − (39,966 × 3) = 119,900 − 119,898 = **2 paise**
- Payer (Rohan) gets +1, next participant gets +1:

| Participant | Share (₹) | Notes |
|-------------|-----------|-------|
| Rohan (payer) | 399.68 | base + 0.01 (1st remainder paisa) |
| Aisha       | 399.67    | base + 0.01 (2nd remainder paisa) |
| Priya       | 399.66    | base share |
| **Total**   | **1,199.00** | ✓ Exact match. |

**Concrete example 3 — Row 34: "Deep cleaning service" (₹2,500 ÷ 3)**
- 250,000 paise ÷ 3 = 83,333.33 → floor = 83,333 paise = ₹833.33
- Remainder: 250,000 − (83,333 × 3) = 250,000 − 249,999 = **1 paisa**
- Payer (Rohan) absorbs: Rohan ₹833.34, Aisha ₹833.33, Priya ₹833.33 = ₹2,500.00 ✓

**Pre-split rounding for odd-precision amounts:**
Row 10 ("Cylinder refill") has amount 899.995 INR (3 decimal places). Before
splitting, round the total to 2 decimals: 899.995 → **₹900.00** (standard
banker's rounding). This happens once, at parse time, before the split engine
runs. The split is then 900.00 ÷ 4 = 225.00 each — no remainder.

**Rationale:** Assigning remainder to payer is the simplest, most common approach
(Splitwise does this). The maximum possible remainder is `n-1` paise (where n
is participant count). The payer already fronted the money, so absorbing a few
extra paise of "their own expense" is the least surprising resolution.

**Invariant:** For every expense, `SUM(expense_splits.amount) = expenses.amount`
exactly. The split engine verifies this after every computation and throws an
error if it doesn't hold. No silent rounding drift.

---

## D-007: csv_row_number vs date — Independent Traceability Fields

**Date:** 2026-06-14  
**Decision:** `csv_row_number` and `date` are two independent fields serving
different purposes. They must never be conflated.

| Field | Purpose | Source | Mutable? |
|-------|---------|--------|----------|
| `csv_row_number` | Traceability — "this record came from line N of the original CSV" | Literal line number in the file (1-indexed from data rows, header excluded) | **Never changes** |
| `date` | Chronology — sorting, membership-window checks, display | Parsed/corrected value (e.g., "Mar-14" → 2026-03-14) | Can be corrected during import |

**Why this matters:** Row 34 in the CSV has date "04-05-2026" which we resolve
to 2026-05-04 (May 4). Its `csv_row_number = 33` (33rd data row). Row 35 has
date 01-04-2026 (April 1) with `csv_row_number = 34`. Chronologically, April 1
comes before May 4, but in the CSV file, the May row appears first. We do NOT
reorder csv_row_number — it always reflects the physical file layout. We sort
by `date` for display and business logic.

**Likely review question:** "Why does csv_row_number 33 have a later date than
csv_row_number 34?" Answer: because the CSV wasn't sorted chronologically and
we preserve the original row numbering for traceability.

---

## D-008: Row 34 Date Resolution — "04-05-2026" = May 4, 2026

**Date:** 2026-06-14  
**Decision:** Parse "04-05-2026" as DD-MM-YYYY → **4 May 2026** (2026-05-04).

**Primary justification (format consistency):** Every other date in the CSV uses
DD-MM-YYYY format. Examples: "01-02-2026" = Feb 1, "08-03-2026" = Mar 8,
"25-02-2026" = Feb 25. For internal consistency, we apply the same DD-MM-YYYY
rule to "04-05-2026" → day=04, month=05 → May 4.

**Secondary observation (weak, does not contradict primary):** Meera moved out
on 2026-03-28. The expense's `split_with` is "Aisha;Rohan;Priya" (no Meera),
which is consistent with any date after March 28 — both April 5 and May 4
satisfy this. This observation alone can't disambiguate, but it doesn't
contradict the DD-MM interpretation.

**Options considered:**
| Interpretation | Result | Reasoning |
|---|---|---|
| DD-MM-YYYY (chosen) | May 4, 2026 | Consistent with every other date in the CSV |
| MM-DD-YYYY | April 5, 2026 | Would require this row to use a different format than the rest — no justification for that |

---

## D-009: Sam's Deposit (Row 38) — Settlement Creating Standing Credit

**Date:** 2026-06-14  
**Decision:** Import "Sam deposit share" (₹15,000) as a **Settlement** record
(Sam → Aisha, ₹15,000), not as an expense.

**What this means under the balance formula:**

Settlements normally reduce existing mutual debt. Here, Sam has no prior debt
with Aisha — so the settlement creates a **standing credit**: Aisha "owes"
Sam ₹15,000 until enough shared expenses draw it down.

This is intentional. The deposit pre-funds Sam's future share of shared costs.
As Sam gets charged for his portion of electricity, groceries, furniture, etc.,
that credit gradually reduces.

**Worked example with real April data (Sam vs Aisha only):**

```
STEP 1 — Settlement
  Row 38: Sam → Aisha, ₹15,000
  Running balance: Aisha owes Sam ₹15,000

STEP 2 — Expenses where Aisha paid, Sam participates
  Row 40 (Electricity Apr): ₹1,380 ÷ 4 = Sam's share ₹345
  Row 42 (Furniture):       ₹12,000 ÷ 4 = Sam's share ₹3,000
  Subtotal Sam owes Aisha from expenses: ₹3,345

STEP 3 — Expenses where Sam paid, Aisha participates
  Row 39 (Housewarming):    ₹3,100 ÷ 4 = Aisha's share ₹775
  Row 41 (Groceries DMart): ₹1,990 ÷ 4 = Aisha's share ₹497.50
  Subtotal Aisha owes Sam from expenses: ₹1,272.50

STEP 4 — Net
  Net from expenses: Sam owes Aisha ₹3,345 − ₹1,272.50 = ₹2,072.50
  Minus settlement:  ₹2,072.50 − ₹15,000 = −₹12,927.50
  
  Result: Aisha owes Sam ₹12,927.50 (credit not yet fully drawn down)
```

**Does this make sense?** Yes. Sam paid a large upfront deposit. After one
month of shared living (utilities ≈ ₹345 + groceries ≈ ₹498 + furniture
₹3,000 = ≈₹3,843 in Aisha-paid expenses charged to Sam), only ₹2,072.50
net has been drawn down. Note: Sam is NOT in the April rent split (row 35
only has Aisha, Rohan, Priya), so the credit draws down slowly through
utilities and groceries only. At ≈₹1,500–2,000/month in Aisha-paid expenses
reaching Sam, the ₹15,000 credit would take several months to zero out —
which is exactly how security deposits work in shared housing.

---

## D-010: Guest Participants — Decision Tree for Participant Validation

**Date:** 2026-06-14  
**Decision:** Introduce three participant categories: **member**, **guest**, and
**stale member**. Each is handled differently during import.

**Decision tree (applied to every name in `split_with`):**

```
Is this person an active member of the expense's group on the expense date?
  ├─ YES → Normal participant. No anomaly logged.
  │
  └─ NO → Does this person have a group_memberships row for this group?
       │
       ├─ YES (was a member, but expense date is outside their window)
       │    → STALE_MEMBERSHIP (severity: warning)
       │    → Action: EXCLUDE from split, redistribute their share
       │    → Example: Meera in row 36 (left 28-Mar, expense on 02-Apr)
       │
       └─ NO (never a member of this group)
            → GUEST_PARTICIPANT (severity: info)
            → Action: INCLUDE in split, create user if needed
            → Example: Dev in row 5 (Feb dinner, not a Flat member)
            → Example: Kabir in row 23 (Parasailing)
```

**Why guests are INCLUDED, not excluded:**
The expense creator explicitly listed them in `split_with`. Excluding a guest
and redistributing their share would unfairly charge the real members more.
The guest legitimately participated in the expense (ate the dinner, went
parasailing). Their share should be tracked.

**Dev vs Kabir — same treatment, different practical outcomes:**

| Person | Context | Treatment | Practical outcome |
|--------|---------|-----------|-------------------|
| Dev | Feb dinner (row 5): visiting for the weekend. Not a Flat member, but a real user who later has his own expenses in the Goa Trip group. | Guest in Flat group for this expense. Charged ₹800 (3200÷4). | Dev is a real app user — his Flat-group guest balance can be viewed and settled within the app. |
| Kabir | Parasailing (row 23): "Dev's friend", one-time participant. Never pays for anything, never appears again. | Guest in Goa Trip group for this expense. Charged his share (₹2,490 after USD→INR conversion, ÷5). | Kabir exists as a user record for tracking, but his balance is effectively unresolvable within the app — Dev would collect from Kabir outside the app. |

**Why NOT exclude Kabir:** If we excluded Kabir and redistributed his share,
the four flatmates would each pay 25% of a ₹12,450 parasailing expense
(₹3,112.50 each) instead of the fair 20% split (₹2,490 each). That's ₹622.50
extra per person for an activity Kabir participated in. Tracking Kabir's debt
(even if uncollectable within the app) is more accurate than silently
redistributing it.

**STALE_MEMBERSHIP vs GUEST_PARTICIPANT — key distinction:**
- STALE_MEMBERSHIP = person *was* a member, left, and someone forgot to remove
  them from `split_with`. The CSV's participant list is stale data. We correct
  it by excluding them.
- GUEST_PARTICIPANT = person was *never* a group member. Their inclusion in
  `split_with` is intentional — they actually participated in that specific
  expense. We honor it.

---

## D-011: exchange_rate = 1.0 for INR — Schema Uniformity

**Date:** 2026-06-14  
**Decision:** Every expense row stores an `exchange_rate` value: 1.0 for INR
expenses, 83.0 for USD expenses. INR rows do not "need" this field, but storing
it avoids special-casing currency logic. The formula `original_amount ×
exchange_rate = amount` holds universally for every row, with no conditionals.
This is intentional, not an oversight.

---

## D-012: split_type vs split_details Conflict Resolution

**Date:** 2026-06-14  
**Decision:** `split_type` is the authoritative field. When `split_details` is
present but conflicts with `split_type`, log a `SPLIT_TYPE_CONFLICT` anomaly
(info severity) and use `split_type` for the computation.

**Options considered:**
| Option | Pros | Cons |
|---|---|---|
| split_type wins (chosen) | split_type is the explicit declaration of intent; consistent rule | Could ignore intentionally added details |
| split_details wins when present | More specific data used | split_details could be stale leftovers from an earlier edit; dangerous to trust implicitly |

**Rationale:** `split_type` declares the split *algorithm* (equal, unequal,
percentage, share). `split_details` provides *parameters* for that algorithm.
When `split_type = equal`, the algorithm needs no parameters — "divide evenly"
is fully specified by the participant list. Any split_details present alongside
`split_type = equal` are redundant at best, stale at worst.

**Row 42 example:** split_type = "equal", split_details = "Aisha 1; Rohan 1;
Priya 1; Sam 1". The shares are all 1 (i.e., equal), so the outcome is
identical either way. But we still log the conflict: the note itself says
"split_type says equal but someone added shares anyway" — confirming the
split_details were added by mistake. Our rule correctly ignores them.

---

## D-013: Prisma Version — v5 (Stable) over v7 (Latest)

**Date:** 2026-06-14  
**Decision:** Use Prisma v5 (latest stable 5.x) instead of Prisma v7 (latest).

**What happened:** npm installed Prisma v7.8.0 by default. Prisma 7 has
breaking changes: the `url` field in `datasource` is removed from schema.prisma
and must be configured in a separate `prisma.config.ts` file using ESM imports.
This adds complexity (TypeScript config file, ESM module mode) that doesn't
help our use case and is harder to explain in a code review.

**Why v5:** Prisma 5 is the last major version where the schema file is
self-contained — `datasource db { url = env("DATABASE_URL") }` works directly.
No extra config files, no ESM requirement. The schema file remains the single
source of truth, which was the whole point of choosing Prisma (D-002).

> **AI_USAGE flag:** This is a case where the AI (Antigravity/Claude) initially
> installed the wrong version without checking for breaking changes. The error
> was caught by `npx prisma validate`, diagnosed, and corrected by downgrading.
> Log this in AI_USAGE.md as correction #1.

---
