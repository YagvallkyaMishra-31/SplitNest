// =============================================================================
// CSV Parser — Read and normalize raw CSV data
// =============================================================================
// This module handles the FIRST stage of the import pipeline:
//   Raw CSV text → Array of structured row objects
//
// It does basic normalization (trim, parse amounts, parse dates, resolve names)
// and logs anomalies for anything it had to fix. It does NOT do cross-row
// validation (like duplicate detection) — that's the anomaly detector's job.
//
// Each returned row has:
//   - csvRowNumber: immutable line number from the original file (D-007)
//   - raw.*: the original values exactly as they appeared in the CSV
//   - parsed.*: the normalized/corrected values
//   - anomalies: array of issues found during parsing

const { parse } = require('csv-parse/sync');
const {
  USD_TO_INR_RATE,
  BASE_CURRENCY,
  NAME_VARIANTS,
  CANONICAL_NAMES,
  ANOMALY_TYPES,
  SEVERITY,
  ACTION,
} = require('../config/constants');

// =============================================================================
// Name Resolution
// =============================================================================
// Normalizes a raw name from the CSV to a canonical form.
// Handles: lowercase ("priya"), trailing spaces ("rohan "), variants ("Priya S"),
// and compound names ("Dev's friend Kabir").
//
// Returns: { canonical: "Priya", anomaly: null | { type, ... } }

function resolveName(rawName, csvRowNumber) {
  const trimmed = rawName.trim();
  if (!trimmed) return { canonical: null, anomaly: null };

  const lower = trimmed.toLowerCase();
  const anomalies = [];

  // Step 1: Check the explicit variant map (e.g., "Priya S" → "Priya")
  if (NAME_VARIANTS[lower]) {
    const canonical = NAME_VARIANTS[lower];
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.NAME_VARIANT,
      severity: SEVERITY.INFO,
      field: 'paid_by/split_with',
      originalValue: trimmed,
      resolvedValue: canonical,
      description: `Name variant "${trimmed}" resolved to canonical name "${canonical}"`,
      actionTaken: ACTION.AUTO_FIXED,
    });
    return { canonical, anomalies };
  }

  // Step 2: Case-insensitive match against canonical names
  const match = CANONICAL_NAMES.find(name => name.toLowerCase() === lower);
  if (match) {
    // If the raw name differs from the canonical form, it's a case issue
    if (trimmed !== match) {
      anomalies.push({
        csvRowNumber,
        anomalyType: ANOMALY_TYPES.NAME_CASE,
        severity: SEVERITY.INFO,
        field: 'paid_by/split_with',
        originalValue: trimmed,
        resolvedValue: match,
        description: `Name "${trimmed}" normalized to "${match}" (case/whitespace fix)`,
        actionTaken: ACTION.AUTO_FIXED,
      });
    }
    return { canonical: match, anomalies };
  }

  // Step 3: Not recognized — capitalize first letter as a best-effort
  // This handles genuinely new names that aren't in our canonical list
  const capitalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  if (trimmed !== capitalized) {
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.NAME_CASE,
      severity: SEVERITY.INFO,
      field: 'paid_by/split_with',
      originalValue: trimmed,
      resolvedValue: capitalized,
      description: `Unknown name "${trimmed}" capitalized to "${capitalized}"`,
      actionTaken: ACTION.AUTO_FIXED,
    });
  }
  return { canonical: capitalized, anomalies };
}

// =============================================================================
// Amount Parsing
// =============================================================================
// Parses a raw amount string from the CSV, handling:
//   - Comma-separated thousands ("1,200" → 1200)
//   - Excess decimal places (899.995 → 900.00)
//   - Negative amounts (-30 → -30)
//   - Zero amounts (0 → 0)
//
// Returns: { amount: number, anomalies: [...] }

function parseAmount(rawAmount, csvRowNumber) {
  const anomalies = [];
  let cleaned = String(rawAmount).trim();

  // Detect comma formatting (e.g., "1,200")
  if (cleaned.includes(',')) {
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.CURRENCY_FORMAT,
      severity: SEVERITY.INFO,
      field: 'amount',
      originalValue: cleaned,
      resolvedValue: cleaned.replace(/,/g, ''),
      description: `Amount "${cleaned}" contains comma formatting, parsed as ${cleaned.replace(/,/g, '')}`,
      actionTaken: ACTION.AUTO_FIXED,
    });
    cleaned = cleaned.replace(/,/g, '');
  }

  let amount = parseFloat(cleaned);
  if (isNaN(amount)) {
    return { amount: null, anomalies };
  }

  // Detect excess decimal places (e.g., 899.995)
  const decimalPart = cleaned.split('.')[1];
  if (decimalPart && decimalPart.length > 2) {
    const rounded = Math.round(amount * 100) / 100;
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.FLOAT_PRECISION,
      severity: SEVERITY.INFO,
      field: 'amount',
      originalValue: cleaned,
      resolvedValue: rounded.toFixed(2),
      description: `Amount ${cleaned} has ${decimalPart.length} decimal places, rounded to ${rounded.toFixed(2)} (D-006)`,
      actionTaken: ACTION.AUTO_FIXED,
    });
    amount = rounded;
  }

  // Detect negative amounts (refunds)
  if (amount < 0) {
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.NEGATIVE_AMOUNT,
      severity: SEVERITY.WARNING,
      field: 'amount',
      originalValue: String(amount),
      resolvedValue: `treated as reverse-split expense: ${amount}`,
      description: `Negative amount ${amount} treated as refund/credit (reverse-split)`,
      actionTaken: ACTION.AUTO_FIXED,
    });
  }

  // Detect zero amounts
  if (amount === 0) {
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.ZERO_AMOUNT,
      severity: SEVERITY.WARNING,
      field: 'amount',
      originalValue: '0',
      resolvedValue: 'imported for audit trail, zero balance impact',
      description: 'Zero-amount expense — no balance impact, kept for audit trail',
      actionTaken: ACTION.AUTO_FIXED,
    });
  }

  return { amount, anomalies };
}

// =============================================================================
// Date Parsing
// =============================================================================
// Parses dates from the CSV, handling three formats:
//   1. DD-MM-YYYY (primary, e.g., "01-02-2026")
//   2. Mon-DD (e.g., "Mar-14" → infer year from context)
//   3. Ambiguous DD-MM vs MM-DD (e.g., "04-05-2026" → DD-MM per D-008)

function parseDate(rawDate, csvRowNumber, surroundingDates) {
  const anomalies = [];
  const trimmed = String(rawDate).trim();

  // Format 1: DD-MM-YYYY (the primary format)
  const ddmmyyyy = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const dayNum = parseInt(day);
    const monthNum = parseInt(month);

    // Check for ambiguity: if both day and month are <= 12, it could be MM-DD
    if (dayNum <= 12 && monthNum <= 12 && dayNum !== monthNum) {
      // Special case: 04-05-2026 — ambiguous (D-008)
      // Primary rule: DD-MM-YYYY for consistency with every other date in CSV
      anomalies.push({
        csvRowNumber,
        anomalyType: ANOMALY_TYPES.DATE_AMBIGUOUS,
        severity: SEVERITY.WARNING,
        field: 'date',
        originalValue: trimmed,
        resolvedValue: `${year}-${month}-${day}`,
        description: `Date "${trimmed}" is ambiguous (DD-MM vs MM-DD). Parsed as DD-MM-YYYY → ${year}-${month}-${day} for format consistency with rest of CSV (D-008)`,
        actionTaken: ACTION.AUTO_FIXED,
      });
    }

    const dateStr = `${year}-${month}-${day}`;
    // Validate the date is real
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) {
      return { date: null, anomalies };
    }
    return { date: dateStr, anomalies };
  }

  // Format 2: Mon-DD (e.g., "Mar-14")
  const monDD = trimmed.match(/^([A-Za-z]{3})-(\d{1,2})$/);
  if (monDD) {
    const [, monthStr, day] = monDD;
    const monthNames = {
      jan: '01', feb: '02', mar: '03', apr: '04',
      may: '05', jun: '06', jul: '07', aug: '08',
      sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = monthNames[monthStr.toLowerCase()];
    if (!month) return { date: null, anomalies };

    // Infer year from surrounding rows (D-008: "Mar-14" falls between 12-03-2026 and 15-03-2026)
    // Default to 2026 since all CSV data is from 2026
    const year = '2026';
    const paddedDay = day.padStart(2, '0');
    const dateStr = `${year}-${month}-${paddedDay}`;

    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.DATE_FORMAT,
      severity: SEVERITY.WARNING,
      field: 'date',
      originalValue: trimmed,
      resolvedValue: dateStr,
      description: `Non-standard date "${trimmed}" parsed as ${dateStr} (year inferred from surrounding rows, all data is from 2026)`,
      actionTaken: ACTION.AUTO_FIXED,
    });

    return { date: dateStr, anomalies };
  }

  // Unrecognized format
  return { date: null, anomalies };
}

// =============================================================================
// Currency Handling
// =============================================================================

function parseCurrency(rawCurrency, amount, csvRowNumber) {
  const anomalies = [];
  let currency = String(rawCurrency || '').trim().toUpperCase();

  // Missing currency → default to INR (anomaly #15)
  if (!currency) {
    currency = BASE_CURRENCY;
    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.MISSING_CURRENCY,
      severity: SEVERITY.WARNING,
      field: 'currency',
      originalValue: '',
      resolvedValue: `${BASE_CURRENCY} (assumed — dominant currency in dataset)`,
      description: `Currency field is blank, defaulting to ${BASE_CURRENCY}`,
      actionTaken: ACTION.AUTO_FIXED,
    });
  }

  // Convert USD → INR (anomaly #10)
  let convertedAmount = amount;
  let exchangeRate = 1.0;
  const originalAmount = amount;
  const originalCurrency = currency;

  if (currency === 'USD') {
    convertedAmount = Math.round(amount * USD_TO_INR_RATE * 100) / 100;
    exchangeRate = USD_TO_INR_RATE;
    currency = BASE_CURRENCY;

    anomalies.push({
      csvRowNumber,
      anomalyType: ANOMALY_TYPES.CURRENCY_MISMATCH,
      severity: SEVERITY.INFO,
      field: 'currency',
      originalValue: `${amount} USD`,
      resolvedValue: `${convertedAmount.toFixed(2)} INR @ ${USD_TO_INR_RATE} INR/USD`,
      description: `USD amount converted: ${Math.abs(amount)} USD × ${USD_TO_INR_RATE} = ${Math.abs(convertedAmount).toFixed(2)} INR (D-005)`,
      actionTaken: ACTION.AUTO_FIXED,
    });
  }

  return {
    currency,
    originalCurrency,
    originalAmount,
    convertedAmount,
    exchangeRate,
    anomalies,
  };
}

// =============================================================================
// Split Details Parsing
// =============================================================================
// Parses the split_details field like "Rohan 700; Priya 400; Meera 400"
// or "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%"
// or "Aisha 1; Rohan 2; Priya 1; Dev 2"

function parseSplitDetails(rawDetails) {
  if (!rawDetails || !rawDetails.trim()) return [];

  return rawDetails.split(';').map(part => {
    const trimmed = part.trim();
    // Match: "Name Value%" or "Name Value"
    const match = trimmed.match(/^(.+?)\s+([\d.]+)(%?)$/);
    if (!match) return null;

    const [, rawName, value, isPercent] = match;
    return {
      rawName: rawName.trim(),
      value: parseFloat(value),
      isPercent: isPercent === '%',
    };
  }).filter(Boolean);
}

// =============================================================================
// Split With Parsing
// =============================================================================
// Parses "Aisha;Rohan;Priya;Meera" → ["Aisha", "Rohan", "Priya", "Meera"]
// with name normalization applied to each participant

function parseSplitWith(rawSplitWith, csvRowNumber) {
  if (!rawSplitWith || !rawSplitWith.trim()) return { participants: [], anomalies: [] };

  const allAnomalies = [];
  const participants = rawSplitWith.split(';').map(raw => {
    const { canonical, anomalies } = resolveName(raw, csvRowNumber);
    if (anomalies && anomalies.length > 0) allAnomalies.push(...anomalies);
    return canonical;
  }).filter(Boolean);

  return { participants, anomalies: allAnomalies };
}

// =============================================================================
// Main Parser — parseCSV()
// =============================================================================
// Takes raw CSV text, returns an array of parsed row objects.
// Each object contains raw values, parsed values, and any anomalies found.

function parseCSV(csvText) {
  // Use csv-parse to handle quoted fields, commas in values, etc.
  const records = parse(csvText, {
    columns: true,          // Use first row as column headers
    skip_empty_lines: true, // Don't create objects for blank lines
    trim: false,            // We do our own trimming to detect whitespace issues
    relax_quotes: true,     // Handle slightly malformed quotes
    relax_column_count: true,
  });

  const parsedRows = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const csvRowNumber = i + 1; // 1-indexed from data rows, header excluded (D-007)
    const rowAnomalies = [];

    // --- Parse each field ---

    // Date
    const { date, anomalies: dateAnomalies } = parseDate(
      record.date, csvRowNumber
    );
    rowAnomalies.push(...dateAnomalies);

    // Description (just trim)
    const description = (record.description || '').trim();

    // Paid By (name resolution)
    const rawPaidBy = (record.paid_by || '').trim();
    let paidBy = null;
    if (!rawPaidBy) {
      rowAnomalies.push({
        csvRowNumber,
        anomalyType: ANOMALY_TYPES.MISSING_PAYER,
        severity: SEVERITY.ERROR,
        field: 'paid_by',
        originalValue: '',
        resolvedValue: null,
        description: 'Payer field is empty — expense excluded from balances until a payer is assigned',
        actionTaken: ACTION.NEEDS_REVIEW,
      });
    } else {
      const { canonical, anomalies: nameAnomalies } = resolveName(rawPaidBy, csvRowNumber);
      paidBy = canonical;
      if (nameAnomalies) rowAnomalies.push(...nameAnomalies);
    }

    // Amount
    const { amount, anomalies: amountAnomalies } = parseAmount(record.amount, csvRowNumber);
    rowAnomalies.push(...amountAnomalies);

    // Currency + conversion
    const {
      currency, originalCurrency, originalAmount,
      convertedAmount, exchangeRate, anomalies: currencyAnomalies,
    } = parseCurrency(record.currency, amount, csvRowNumber);
    rowAnomalies.push(...currencyAnomalies);

    // Split type
    const splitType = (record.split_type || '').trim().toLowerCase();

    // Split with (participants)
    const { participants, anomalies: participantAnomalies } = parseSplitWith(
      record.split_with, csvRowNumber
    );
    rowAnomalies.push(...participantAnomalies);

    // Split details
    const splitDetails = parseSplitDetails(record.split_details);

    // Notes
    const notes = (record.notes || '').trim();

    // --- Check for split_type conflicts (D-012) ---
    if (splitType === 'equal' && splitDetails.length > 0) {
      rowAnomalies.push({
        csvRowNumber,
        anomalyType: ANOMALY_TYPES.SPLIT_TYPE_CONFLICT,
        severity: SEVERITY.INFO,
        field: 'split_type',
        originalValue: `split_type='equal', split_details='${record.split_details}'`,
        resolvedValue: "split_type 'equal' used as authoritative, split_details ignored (D-012)",
        description: 'split_type says "equal" but split_details are also provided — using split_type per D-012',
        actionTaken: ACTION.AUTO_FIXED,
      });
    }

    parsedRows.push({
      csvRowNumber,
      raw: { ...record }, // Keep original values for the import report
      parsed: {
        date,
        description,
        paidBy,
        amount: convertedAmount,
        originalAmount: originalAmount,
        originalCurrency,
        currency,
        exchangeRate,
        splitType: splitType || null,
        participants,
        splitDetails,
        notes,
      },
      anomalies: rowAnomalies,
    });
  }

  return parsedRows;
}

module.exports = { parseCSV, resolveName, parseAmount, parseDate, parseSplitDetails };
