# SCOPE.md — Anomaly Log & Schema Documentation

> This document catalogs every issue found in `Expenses_Export.csv`, how each
> was detected, and how it was handled. It also serves as the spec for the
> import anomaly detection system.

---

## Anomaly Type Reference — `original_value` / `resolved_value` Field Definitions

This table defines exactly what gets stored in `import_anomalies.original_value`
and `import_anomalies.resolved_value` for each anomaly type code. The import
code implements this spec — it does not improvise per-row.

| Anomaly Type | Severity | `original_value` | `resolved_value` | `action_taken` |
|---|---|---|---|---|
| `DUPLICATE_EXPENSE` | warning | Both row numbers + key fields. E.g., `"rows 5,6: Dev, 3200 INR, 08-02-2026, 'Dinner at Marina Bites'/'dinner - marina bites'"` | The kept row's csv_row_number. E.g., `"kept row 5, dropped row 6"` | `flagged` (user confirms in approval step) |
| `CURRENCY_FORMAT` | info | Raw amount string with formatting. E.g., `"1,200"` | Parsed numeric value. E.g., `"1200"` | `auto_fixed` |
| `NAME_CASE` | info | Raw name string. E.g., `"priya"` or `"rohan "` | Canonical user name. E.g., `"Priya"` or `"Rohan"` | `auto_fixed` |
| `FLOAT_PRECISION` | info | Raw amount with excess decimals. E.g., `"899.995"` | Rounded amount. E.g., `"900.00"` | `auto_fixed` |
| `NAME_VARIANT` | info | Raw name with extra text. E.g., `"Priya S"` | Canonical user name. E.g., `"Priya"` | `auto_fixed` |
| `MISSING_PAYER` | error | Empty string `""` | `null` — expense imported but excluded from balance calculations | `needs_review` |
| `SETTLEMENT_AS_EXPENSE` | warning | Detection trigger text. E.g., `"description='Rohan paid Aisha back', notes='this is a settlement not an expense??', split_type=empty, single recipient"` | Settlement record created. E.g., `"imported as settlement: Rohan → Aisha, ₹5,000"` | `auto_fixed` |
| `PERCENTAGE_SUM` | warning | Raw percentages and their sum. E.g., `"Aisha 30% + Rohan 30% + Priya 30% + Meera 20% = 110%"` | Normalized percentages. E.g., `"Aisha 27.27% + Rohan 27.27% + Priya 27.27% + Meera 18.18% = 100% (scaled proportionally)"` | `auto_fixed` |
| `CURRENCY_MISMATCH` | info | Original amount and currency. E.g., `"540 USD"` | Converted amount with rate. E.g., `"44820.00 INR @ 83.00 INR/USD"` | `auto_fixed` |
| `NEGATIVE_AMOUNT` | warning | Raw negative amount. E.g., `"-30 USD"` | Treatment applied. E.g., `"treated as reverse-split expense: -2490.00 INR total, each of 4 participants credited ₹622.50"` | `auto_fixed` |
| `GUEST_PARTICIPANT` | info | Participant name and context. E.g., `"Dev's friend Kabir (not a member of any group)"` or `"Dev (not a member of Flat group on 08-02-2026)"` | Treatment. E.g., `"included as guest participant, charged ₹2,490.00 (their share)"` | `auto_fixed` |
| `DATE_FORMAT` | warning | Raw date string. E.g., `"Mar-14"` | Parsed ISO date with reasoning. E.g., `"2026-03-14 (year inferred: between rows dated 12-03-2026 and 15-03-2026)"` | `auto_fixed` |
| `DATE_AMBIGUOUS` | warning | Raw date string. E.g., `"04-05-2026"` | Parsed ISO date with reasoning. E.g., `"2026-05-04 (DD-MM-YYYY per format consistency with rest of CSV)"` | `auto_fixed` |
| `PROBABLE_DUPLICATE` | warning | Both rows' key fields. E.g., `"row 24: Aisha, ₹2,400, 'Dinner at Thalassa' / row 25: Rohan, ₹2,450, 'Thalassa dinner', note: 'Aisha also logged this I think hers is wrong'"` | Pending user decision. E.g., `"recommend: keep row 25 (Rohan, ₹2,450) per note — requires user confirmation"` | `flagged` |
| `MISSING_CURRENCY` | warning | Empty string `""` | Assumed currency. E.g., `"INR (assumed — dominant currency in dataset)"` | `auto_fixed` |
| `ZERO_AMOUNT` | warning | `"0"` | Import decision. E.g., `"imported for audit trail, zero balance impact, note: 'counted twice earlier - fixing later'"` | `auto_fixed` |
| `SPLIT_TYPE_CONFLICT` | info | Both fields' values. E.g., `"split_type='equal', split_details='Aisha 1; Rohan 1; Priya 1; Sam 1'"` | Which field won. E.g., `"split_type 'equal' used as authoritative, split_details ignored (per D-012)"` | `auto_fixed` |
| `STALE_MEMBERSHIP` | warning | Participant + membership window. E.g., `"Meera (member 01-02-2026 to 28-03-2026) in split_with on 02-04-2026"` | Treatment. E.g., `"Meera excluded from split, her share redistributed among 3 active members (Aisha, Rohan, Priya)"` | `auto_fixed` |
| `NON_EXPENSE` | warning | Description/notes triggering detection. E.g., `"description='Sam deposit share', notes='Sam moving in! paid Aisha his deposit', single recipient in split_with"` | How imported. E.g., `"imported as settlement: Sam → Aisha, ₹15,000 (per D-009)"` | `auto_fixed` |
| `UNEQUAL_SUM_MISMATCH` | error | Raw amounts and comparison. E.g., `"split amounts: X+Y+Z=W, expense total=T, difference=W-T"` | Resolution. E.g., `"flagged for user review — amounts not auto-adjusted"` | `flagged` |

---

## Complete Anomaly Log — Expenses_Export.csv

Every anomaly found in the CSV, listed by csv_row_number (1-indexed from data
rows, header excluded).

| # | CSV Row | Description | Field | Anomaly Type | Severity | Original Value | Resolved Value | Action |
|---|---------|-------------|-------|-------------|----------|---------------|---------------|--------|
| 1 | 5–6 | Duplicate expense: same date (08-02-2026), payer (Dev), amount (3200 INR), similar description | description | `DUPLICATE_EXPENSE` | warning | rows 5,6: "Dinner at Marina Bites"/"dinner - marina bites" | kept row 5, dropped row 6 | flagged |
| 2 | 6 | Amount has comma as thousands separator | amount | `CURRENCY_FORMAT` | info | "1,200" | 1200 | auto_fixed |
| 3a | 8 | Payer name lowercase | paid_by | `NAME_CASE` | info | "priya" | "Priya" | auto_fixed |
| 3b | 26 | Payer name lowercase + trailing space | paid_by | `NAME_CASE` | info | "rohan " | "Rohan" | auto_fixed |
| 4 | 9 | Amount has 3 decimal places | amount | `FLOAT_PRECISION` | info | "899.995" | "900.00" | auto_fixed |
| 5 | 10 | Payer name has trailing initial | paid_by | `NAME_VARIANT` | info | "Priya S" | "Priya" | auto_fixed |
| 6 | 12 | paid_by field is empty | paid_by | `MISSING_PAYER` | error | "" | null | needs_review |
| 7 | 13 | Row is a settlement, not an expense | split_type | `SETTLEMENT_AS_EXPENSE` | warning | "Rohan paid Aisha back", no split_type, single recipient | settlement: Rohan → Aisha, ₹5,000 | auto_fixed |
| 8a | 14 | Percentages sum to 110% (30+30+30+20) | split_details | `PERCENTAGE_SUM` | warning | 30+30+30+20=110 | 27.27+27.27+27.27+18.18=100 | auto_fixed |
| 8b | 31 | Same 110% issue on Weekend brunch | split_details | `PERCENTAGE_SUM` | warning | 30+30+30+20=110 | 27.27+27.27+27.27+18.18=100 | auto_fixed |
| 9a | 19 | USD currency needs conversion | currency | `CURRENCY_MISMATCH` | info | "540 USD" | "44,820.00 INR @ 83.00" | auto_fixed |
| 9b | 20 | USD currency needs conversion | currency | `CURRENCY_MISMATCH` | info | "84 USD" | "6,972.00 INR @ 83.00" | auto_fixed |
| 9c | 22 | USD currency needs conversion | currency | `CURRENCY_MISMATCH` | info | "150 USD" | "12,450.00 INR @ 83.00" | auto_fixed |
| 9d | 25 | USD currency needs conversion (negative) | currency | `CURRENCY_MISMATCH` | info | "-30 USD" | "-2,490.00 INR @ 83.00" | auto_fixed |
| 10 | 25 | Negative amount (refund) | amount | `NEGATIVE_AMOUNT` | warning | "-30 USD" | "reverse-split: each of 4 participants credited their share" | auto_fixed |
| 11a | 4–5 | Dev is not a Flat group member (visiting for weekend dinner) | split_with | `GUEST_PARTICIPANT` | info | "Dev" | "included as guest, charged ₹800" | auto_fixed |
| 11b | 22 | Kabir is not a member of any group | split_with | `GUEST_PARTICIPANT` | info | "Dev's friend Kabir" | "included as guest, charged his share" | auto_fixed |
| 12 | 26 | Non-standard date format, no year | date | `DATE_FORMAT` | warning | "Mar-14" | "2026-03-14" | auto_fixed |
| 13 | 33 | Ambiguous DD-MM vs MM-DD date | date | `DATE_AMBIGUOUS` | warning | "04-05-2026" | "2026-05-04 (May 4)" | auto_fixed |
| 14 | 23–24 | Probable duplicate dinner with different amounts and payers | description | `PROBABLE_DUPLICATE` | warning | row 23: Aisha ₹2,400 / row 24: Rohan ₹2,450 | recommend keep row 24 per note | flagged |
| 15 | 27 | Currency field is blank | currency | `MISSING_CURRENCY` | warning | "" | "INR (assumed)" | auto_fixed |
| 16 | 30 | Zero-amount expense | amount | `ZERO_AMOUNT` | warning | "0" | "imported for audit trail, no balance impact" | auto_fixed |
| 17 | 41 | split_type="equal" but split_details has shares | split_type | `SPLIT_TYPE_CONFLICT` | info | "equal + details: Aisha 1; Rohan 1; Priya 1; Sam 1" | "split_type 'equal' used" | auto_fixed |
| 18 | 35 | Meera in split_with after she left the group | split_with | `STALE_MEMBERSHIP` | warning | "Meera (left 28-03-2026) on 02-04-2026" | "excluded, share redistributed" | auto_fixed |
| 19 | 37 | Personal deposit logged as expense | description | `NON_EXPENSE` | warning | "Sam deposit share — paid Aisha his deposit" | "settlement: Sam → Aisha, ₹15,000" | auto_fixed |

**Total: 19 distinct anomaly types across 25+ individual anomaly instances.**

> Note: Some anomaly types fire multiple times (e.g., CURRENCY_MISMATCH fires
> on 4 USD rows, PERCENTAGE_SUM fires twice, NAME_CASE fires twice). The 20
> type codes cover all possible anomaly categories; this CSV triggers 19 of
> them (UNEQUAL_SUM_MISMATCH is not triggered — row 12's unequal split
> 700+400+400=1500 matches the total correctly).

---

## Database Schema

See the schema ER diagram and table definitions in the implementation plan.
The Prisma schema file (`prisma/schema.prisma`) is the canonical source of
truth for the database structure after project initialization.

### Tables Summary

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| `users` | People who share expenses (auth + display name) | Referenced by expenses, splits, settlements, memberships |
| `groups` | Named expense-sharing groups ("Flat 4B", "Goa Trip") | Contains expenses and settlements |
| `group_memberships` | Who was in which group, and when (joined_at/left_at) | Links users ↔ groups with time windows |
| `expenses` | What was paid, by whom, when, in what currency | Belongs to a group, paid by a user |
| `expense_splits` | Each person's exact share of each expense | Links expenses ↔ users with amounts |
| `settlements` | Direct payments between people (debt reduction) | Between two users within a group |
| `import_sessions` | Import batch metadata + approval workflow | Groups anomalies and imported records |
| `import_anomalies` | Every issue detected during CSV import | Belongs to an import session |
