// =============================================================================
// Constants — All configurable values in one place
// =============================================================================
// Every "magic number" or policy value is defined here so it can be:
//   1. Found instantly during a code review ("where's the FX rate?")
//   2. Changed in one place without hunting through business logic
//   3. Referenced by DECISIONS.md entry number for traceability

// --- Currency Conversion (D-005) ---
// Fixed exchange rate for USD→INR conversion. Not calling a live API
// because we need reproducible, auditable results.
const USD_TO_INR_RATE = 83.0;

// The "home" currency that all amounts are normalized to.
const BASE_CURRENCY = 'INR';

// --- Rounding (D-006) ---
// All monetary amounts are stored with 2 decimal places (paise precision).
const DECIMAL_PLACES = 2;

// --- Name Normalization ---
// Maps known name variants to their canonical form.
// These were identified from the CSV: "priya" → "Priya", "Priya S" → "Priya", etc.
// The key is lowercase+trimmed, the value is the canonical name.
const NAME_VARIANTS = {
  'priya s': 'Priya',
  "dev's friend kabir": 'Kabir',
};

// Canonical names for case normalization.
// Any name that matches one of these (case-insensitive, trimmed) resolves to this exact form.
const CANONICAL_NAMES = ['Aisha', 'Rohan', 'Priya', 'Meera', 'Dev', 'Sam', 'Kabir'];

// --- Group Inference ---
// Since the CSV has no "group" column, we infer groups from participant patterns and dates.
// Goa trip dates: 08-03-2026 to 14-03-2026 (row 19 "trip starts!" to row 27 "Airport cab")
const GOA_TRIP_START = '2026-03-08';
const GOA_TRIP_END = '2026-03-14';
const GOA_TRIP_MEMBERS = ['Aisha', 'Rohan', 'Priya', 'Dev'];

// Flat group membership windows (from CSV timeline analysis)
const FLAT_MEMBERSHIPS = [
  { name: 'Aisha',  joinedAt: '2026-02-01', leftAt: null },
  { name: 'Rohan',  joinedAt: '2026-02-01', leftAt: null },
  { name: 'Priya',  joinedAt: '2026-02-01', leftAt: null },
  { name: 'Meera',  joinedAt: '2026-02-01', leftAt: '2026-03-28' },
  { name: 'Sam',    joinedAt: '2026-04-08', leftAt: null },
];

const GOA_MEMBERSHIPS = [
  { name: 'Aisha',  joinedAt: '2026-03-08', leftAt: '2026-03-14' },
  { name: 'Rohan',  joinedAt: '2026-03-08', leftAt: '2026-03-14' },
  { name: 'Priya',  joinedAt: '2026-03-08', leftAt: '2026-03-14' },
  { name: 'Dev',    joinedAt: '2026-03-08', leftAt: '2026-03-14' },
];

// --- Settlement Detection ---
// Keywords in description or notes that indicate a row is a settlement, not an expense.
const SETTLEMENT_KEYWORDS = [
  'paid back', 'paid .* back', 'settlement', 'settled', 'repaid',
  'deposit share', 'deposit',
];

// --- Anomaly Type Codes (matching SCOPE.md) ---
const ANOMALY_TYPES = {
  DUPLICATE_EXPENSE: 'DUPLICATE_EXPENSE',
  CURRENCY_FORMAT: 'CURRENCY_FORMAT',
  NAME_CASE: 'NAME_CASE',
  FLOAT_PRECISION: 'FLOAT_PRECISION',
  NAME_VARIANT: 'NAME_VARIANT',
  MISSING_PAYER: 'MISSING_PAYER',
  SETTLEMENT_AS_EXPENSE: 'SETTLEMENT_AS_EXPENSE',
  PERCENTAGE_SUM: 'PERCENTAGE_SUM',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  NEGATIVE_AMOUNT: 'NEGATIVE_AMOUNT',
  GUEST_PARTICIPANT: 'GUEST_PARTICIPANT',
  DATE_FORMAT: 'DATE_FORMAT',
  DATE_AMBIGUOUS: 'DATE_AMBIGUOUS',
  PROBABLE_DUPLICATE: 'PROBABLE_DUPLICATE',
  MISSING_CURRENCY: 'MISSING_CURRENCY',
  ZERO_AMOUNT: 'ZERO_AMOUNT',
  SPLIT_TYPE_CONFLICT: 'SPLIT_TYPE_CONFLICT',
  STALE_MEMBERSHIP: 'STALE_MEMBERSHIP',
  NON_EXPENSE: 'NON_EXPENSE',
  UNEQUAL_SUM_MISMATCH: 'UNEQUAL_SUM_MISMATCH',
};

const SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
};

const ACTION = {
  AUTO_FIXED: 'auto_fixed',
  FLAGGED: 'flagged',
  NEEDS_REVIEW: 'needs_review',
  EXCLUDED: 'excluded',
};

module.exports = {
  USD_TO_INR_RATE,
  BASE_CURRENCY,
  DECIMAL_PLACES,
  NAME_VARIANTS,
  CANONICAL_NAMES,
  GOA_TRIP_START,
  GOA_TRIP_END,
  GOA_TRIP_MEMBERS,
  FLAT_MEMBERSHIPS,
  GOA_MEMBERSHIPS,
  SETTLEMENT_KEYWORDS,
  ANOMALY_TYPES,
  SEVERITY,
  ACTION,
};
