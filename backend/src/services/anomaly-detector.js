// =============================================================================
// Anomaly Detector — Cross-row validation
// =============================================================================
// This is Stage 2 of the import pipeline:
//   Parsed rows (from csv-parser) → Anomaly-enriched rows
//
// The CSV parser handles PER-ROW issues (bad names, amounts, dates).
// This module handles CROSS-ROW issues that require seeing multiple rows:
//   - DUPLICATE_EXPENSE: same date+payer+amount, similar description
//   - PROBABLE_DUPLICATE: similar expenses with different amounts/payers
//   - SETTLEMENT_AS_EXPENSE: row looks like a settlement (description keywords)
//   - STALE_MEMBERSHIP: participant wasn't active on expense date
//   - PERCENTAGE_SUM: percentages don't add up to 100%
//   - GUEST_PARTICIPANT: person not a member of any group on that date
//   - NON_EXPENSE: personal deposit or non-shared transaction
//   - UNEQUAL_SUM_MISMATCH: unequal split amounts don't sum to total
//
// Design decision: anomalies are APPENDED to each row's existing anomalies
// array (the parser may have already added some). We never overwrite.

const {
  SETTLEMENT_KEYWORDS,
  FLAT_MEMBERSHIPS,
  GOA_MEMBERSHIPS,
  GOA_TRIP_START,
  GOA_TRIP_END,
  ANOMALY_TYPES,
  SEVERITY,
  ACTION,
  DECIMAL_PLACES,
} = require('../config/constants');

// =============================================================================
// Helper: Normalize description for comparison
// =============================================================================
// Strips punctuation, lowercases, sorts words — so "Dinner at Marina Bites"
// and "dinner - marina bites" both become "bites dinner marina".
// This makes duplicate detection resilient to minor wording differences.

function normalizeDescription(desc) {
  return desc
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '') // Remove punctuation
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// =============================================================================
// Helper: Check if a person was an active member of a group on a given date
// =============================================================================
// Uses the membership windows from constants.js.
// Returns: { isActive: boolean, group: 'Flat'|'Goa'|null }

function getMembershipStatus(name, dateStr) {
  const date = new Date(dateStr);

  // Check Flat group
  const flatMember = FLAT_MEMBERSHIPS.find(m => m.name === name);
  if (flatMember) {
    const joined = new Date(flatMember.joinedAt);
    const left = flatMember.leftAt ? new Date(flatMember.leftAt) : null;
    if (date >= joined && (!left || date <= left)) {
      return { isActive: true, group: 'Flat' };
    }
  }

  // Check Goa group
  const goaMember = GOA_MEMBERSHIPS.find(m => m.name === name);
  if (goaMember) {
    const joined = new Date(goaMember.joinedAt);
    const left = goaMember.leftAt ? new Date(goaMember.leftAt) : null;
    if (date >= joined && (!left || date <= left)) {
      return { isActive: true, group: 'Goa' };
    }
  }

  return { isActive: false, group: null };
}

// =============================================================================
// Helper: Determine which group an expense belongs to
// =============================================================================
// Uses expense date and participants to infer the group.
// Goa trip: dates within GOA_TRIP_START–GOA_TRIP_END and has Dev as participant
// Everything else: Flat group

function inferGroup(parsedRow) {
  const { date, participants } = parsedRow.parsed;
  if (!date) return 'Flat'; // Default

  const expenseDate = new Date(date);
  const goaStart = new Date(GOA_TRIP_START);
  const goaEnd = new Date(GOA_TRIP_END);

  // If date is within Goa trip window AND has Dev (a Goa-only member)
  if (expenseDate >= goaStart && expenseDate <= goaEnd && participants.includes('Dev')) {
    return 'Goa';
  }

  return 'Flat';
}

// =============================================================================
// 1. Duplicate Detection
// =============================================================================
// Two rows are considered duplicates if they share:
//   - Same date
//   - Same payer
//   - Same amount
//   - Similar description (normalized word set)
//
// This catches rows 5–6: "Dinner at Marina Bites" and "dinner - marina bites"
// (same date 08-02-2026, same payer Dev, same amount 3200)

function detectDuplicates(parsedRows) {
  const anomalies = [];
  const seen = new Map(); // key → first row's index

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { date, paidBy, amount, description } = row.parsed;

    if (!date || !paidBy || amount === null) continue;

    // Create a fingerprint: date + payer + amount
    const key = `${date}|${paidBy}|${amount}`;
    const normalizedDesc = normalizeDescription(description);

    if (seen.has(key)) {
      const firstIdx = seen.get(key);
      const firstRow = parsedRows[firstIdx];
      const firstDesc = normalizeDescription(firstRow.parsed.description);

      // Check description similarity (word overlap)
      const firstWords = new Set(firstDesc.split(' '));
      const currentWords = new Set(normalizedDesc.split(' '));
      const overlap = [...firstWords].filter(w => currentWords.has(w)).length;
      const maxWords = Math.max(firstWords.size, currentWords.size);
      const similarity = maxWords > 0 ? overlap / maxWords : 0;

      if (similarity > 0.3) {
        // Mark the second row as duplicate (keep the first)
        anomalies.push({
          rowIndex: i,
          anomaly: {
            csvRowNumber: row.csvRowNumber,
            anomalyType: ANOMALY_TYPES.DUPLICATE_EXPENSE,
            severity: SEVERITY.WARNING,
            field: 'description',
            originalValue: `rows ${firstRow.csvRowNumber},${row.csvRowNumber}: ${firstRow.parsed.paidBy}, ${firstRow.parsed.amount} INR, '${firstRow.parsed.description}'/'${row.parsed.description}'`,
            resolvedValue: `kept row ${firstRow.csvRowNumber}, dropped row ${row.csvRowNumber}`,
            description: `Duplicate expense detected: same date (${date}), payer (${paidBy}), amount (${amount}). Descriptions are similar: "${firstRow.parsed.description}" vs "${row.parsed.description}"`,
            actionTaken: ACTION.FLAGGED,
          },
          markDeleted: true,
        });
      }
    } else {
      seen.set(key, i);
    }
  }

  return anomalies;
}

// =============================================================================
// 2. Probable Duplicate Detection
// =============================================================================
// Two rows on the same date with similar descriptions but DIFFERENT payers
// or amounts. This is rows 24–25: "Dinner at Thalassa" (Aisha, ₹2400) vs
// "Thalassa dinner" (Rohan, ₹2450) with the note "Aisha also logged this".

function detectProbableDuplicates(parsedRows) {
  const anomalies = [];

  // Group rows by date
  const byDate = new Map();
  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    if (!row.parsed.date) continue;
    if (!byDate.has(row.parsed.date)) byDate.set(row.parsed.date, []);
    byDate.get(row.parsed.date).push(i);
  }

  for (const [date, indices] of byDate) {
    if (indices.length < 2) continue;

    // Compare each pair
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const rowA = parsedRows[indices[a]];
        const rowB = parsedRows[indices[b]];

        // Skip if same payer+amount (already caught by exact duplicate check)
        if (rowA.parsed.paidBy === rowB.parsed.paidBy &&
            rowA.parsed.amount === rowB.parsed.amount) continue;

        // Check description similarity
        const descA = normalizeDescription(rowA.parsed.description);
        const descB = normalizeDescription(rowB.parsed.description);
        const wordsA = new Set(descA.split(' '));
        const wordsB = new Set(descB.split(' '));
        const overlap = [...wordsA].filter(w => wordsB.has(w)).length;
        const maxWords = Math.max(wordsA.size, wordsB.size);
        const similarity = maxWords > 0 ? overlap / maxWords : 0;

        if (similarity > 0.4) {
          // Check notes for clues about which to keep
          const allNotes = `${rowA.parsed.notes} ${rowB.parsed.notes}`.toLowerCase();
          let recommendation = 'requires user confirmation';
          if (allNotes.includes('wrong') || allNotes.includes('also logged')) {
            // The note suggests one is wrong — recommend keeping the other
            if (rowB.parsed.notes.toLowerCase().includes('wrong') ||
                rowB.parsed.notes.toLowerCase().includes('also logged')) {
              recommendation = `recommend: keep row ${rowB.csvRowNumber} (${rowB.parsed.paidBy}, ₹${rowB.parsed.amount}) per note — requires user confirmation`;
            } else {
              recommendation = `recommend: keep row ${rowA.csvRowNumber} (${rowA.parsed.paidBy}, ₹${rowA.parsed.amount}) per note — requires user confirmation`;
            }
          }

          anomalies.push({
            rowIndex: indices[a],
            anomaly: {
              csvRowNumber: rowA.csvRowNumber,
              anomalyType: ANOMALY_TYPES.PROBABLE_DUPLICATE,
              severity: SEVERITY.WARNING,
              field: 'description',
              originalValue: `row ${rowA.csvRowNumber}: ${rowA.parsed.paidBy}, ₹${rowA.parsed.amount}, '${rowA.parsed.description}' / row ${rowB.csvRowNumber}: ${rowB.parsed.paidBy}, ₹${rowB.parsed.amount}, '${rowB.parsed.description}'${rowB.parsed.notes ? `, note: '${rowB.parsed.notes}'` : ''}`,
              resolvedValue: recommendation,
              description: `Probable duplicate: similar descriptions on same date (${date}) but different payer/amount. Review needed.`,
              actionTaken: ACTION.FLAGGED,
            },
          });
        }
      }
    }
  }

  return anomalies;
}

// =============================================================================
// 3. Settlement Detection
// =============================================================================
// Rows where the description or notes contain settlement keywords
// (e.g., "paid back", "settlement", "deposit") AND have a single recipient
// in split_with. These should be imported as settlements, not expenses.

function detectSettlements(parsedRows) {
  const anomalies = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { description, notes, participants, splitType, paidBy } = row.parsed;
    const combined = `${description} ${notes}`.toLowerCase();

    // Check if description/notes match settlement keywords
    const isSettlement = SETTLEMENT_KEYWORDS.some(keyword => {
      const regex = new RegExp(keyword, 'i');
      return regex.test(combined);
    });

    if (isSettlement && participants.length === 1 && paidBy) {
      // Determine anomaly type: NON_EXPENSE for deposits, SETTLEMENT_AS_EXPENSE for paybacks
      const isDeposit = combined.includes('deposit');
      const anomalyType = isDeposit
        ? ANOMALY_TYPES.NON_EXPENSE
        : ANOMALY_TYPES.SETTLEMENT_AS_EXPENSE;

      anomalies.push({
        rowIndex: i,
        anomaly: {
          csvRowNumber: row.csvRowNumber,
          anomalyType,
          severity: SEVERITY.WARNING,
          field: 'split_type',
          originalValue: `description='${description}', notes='${notes}', split_type=${splitType || 'empty'}, single recipient`,
          resolvedValue: `imported as settlement: ${paidBy} → ${participants[0]}, ₹${Math.abs(row.parsed.amount).toLocaleString('en-IN')}`,
          description: isDeposit
            ? `Personal deposit detected: "${description}" — importing as settlement (${paidBy} → ${participants[0]}) per D-009`
            : `Settlement detected: "${description}" — not a shared expense. Importing as settlement: ${paidBy} → ${participants[0]}`,
          actionTaken: ACTION.AUTO_FIXED,
        },
        isSettlement: true,
        settlementData: {
          paidBy,
          paidTo: participants[0],
          amount: Math.abs(row.parsed.amount),
        },
      });
    }
  }

  return anomalies;
}

// =============================================================================
// 4. Stale Membership Detection
// =============================================================================
// If a participant in split_with was NOT an active member of the relevant
// group on the expense date, they're "stale" and should be excluded.
// Example: Meera in split_with on 02-04-2026 (she left 28-03-2026)

function detectStaleMemberships(parsedRows) {
  const anomalies = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { date, participants } = row.parsed;
    if (!date || !participants.length) continue;

    const group = inferGroup(row);

    for (const participant of participants) {
      const memberships = group === 'Goa' ? GOA_MEMBERSHIPS : FLAT_MEMBERSHIPS;
      const membership = memberships.find(m => m.name === participant);

      if (membership) {
        // Person is a known member — check if active on this date
        const joined = new Date(membership.joinedAt);
        const left = membership.leftAt ? new Date(membership.leftAt) : null;
        const expenseDate = new Date(date);

        if (expenseDate < joined || (left && expenseDate > left)) {
          anomalies.push({
            rowIndex: i,
            anomaly: {
              csvRowNumber: row.csvRowNumber,
              anomalyType: ANOMALY_TYPES.STALE_MEMBERSHIP,
              severity: SEVERITY.WARNING,
              field: 'split_with',
              originalValue: `${participant} (member ${membership.joinedAt} to ${membership.leftAt || 'ongoing'}) in split_with on ${date}`,
              resolvedValue: `${participant} excluded from split, share redistributed among active members`,
              description: `${participant} was not an active member of the ${group} group on ${date} (membership: ${membership.joinedAt} to ${membership.leftAt || 'ongoing'})`,
              actionTaken: ACTION.AUTO_FIXED,
            },
            excludeParticipant: participant,
          });
        }
      }
      // If person is NOT in any membership list, that's a guest (handled separately)
    }
  }

  return anomalies;
}

// =============================================================================
// 5. Guest Participant Detection
// =============================================================================
// A participant who is not a member of ANY group. This is different from
// stale membership — a stale member was once a member but isn't anymore.
// A guest was never a member at all (e.g., Kabir, or Dev visiting the Flat).

function detectGuestParticipants(parsedRows) {
  const anomalies = [];
  const allMembers = new Set([
    ...FLAT_MEMBERSHIPS.map(m => m.name),
    ...GOA_MEMBERSHIPS.map(m => m.name),
  ]);

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { participants, date } = row.parsed;
    if (!participants.length || !date) continue;

    const group = inferGroup(row);

    for (const participant of participants) {
      // Check 1: Not a member of ANY group → definitely a guest
      if (!allMembers.has(participant)) {
        anomalies.push({
          rowIndex: i,
          anomaly: {
            csvRowNumber: row.csvRowNumber,
            anomalyType: ANOMALY_TYPES.GUEST_PARTICIPANT,
            severity: SEVERITY.INFO,
            field: 'split_with',
            originalValue: `${participant} (not a member of any group)`,
            resolvedValue: `included as guest participant, charged their share`,
            description: `${participant} is not a registered group member — included as guest for this expense`,
            actionTaken: ACTION.AUTO_FIXED,
          },
        });
        continue;
      }

      // Check 2: Member of a different group but not this one
      // (e.g., Dev is a Goa member visiting the Flat for dinner)
      const memberships = group === 'Goa' ? GOA_MEMBERSHIPS : FLAT_MEMBERSHIPS;
      const isMemberOfThisGroup = memberships.some(m => m.name === participant);

      if (!isMemberOfThisGroup) {
        // Check if they're a member of the OTHER group
        const otherMemberships = group === 'Goa' ? FLAT_MEMBERSHIPS : GOA_MEMBERSHIPS;
        const isOtherGroupMember = otherMemberships.some(m => m.name === participant);

        if (isOtherGroupMember) {
          anomalies.push({
            rowIndex: i,
            anomaly: {
              csvRowNumber: row.csvRowNumber,
              anomalyType: ANOMALY_TYPES.GUEST_PARTICIPANT,
              severity: SEVERITY.INFO,
              field: 'split_with',
              originalValue: `${participant} (not a member of ${group} group on ${date})`,
              resolvedValue: `included as guest participant, charged their share`,
              description: `${participant} is a member of another group but not ${group} — included as guest for this expense`,
              actionTaken: ACTION.AUTO_FIXED,
            },
          });
        }
      }
    }
  }

  return anomalies;
}

// =============================================================================
// 6. Percentage Sum Validation
// =============================================================================
// If split_type is "percentage", the percentages should sum to 100%.
// If they don't (e.g., 30+30+30+20 = 110%), we normalize them proportionally.

function detectPercentageSumIssues(parsedRows) {
  const anomalies = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { splitType, splitDetails } = row.parsed;

    if (splitType !== 'percentage' || !splitDetails.length) continue;

    // Only check entries that are percentages
    const percentEntries = splitDetails.filter(d => d.isPercent);
    if (!percentEntries.length) continue;

    const total = percentEntries.reduce((sum, d) => sum + d.value, 0);
    const roundedTotal = Math.round(total * 100) / 100;

    if (Math.abs(roundedTotal - 100) > 0.01) {
      // Normalize proportionally
      const originalParts = percentEntries.map(d => `${d.rawName} ${d.value}%`).join(' + ');
      const normalizedEntries = percentEntries.map(d => ({
        ...d,
        normalizedValue: Math.round((d.value / total) * 100 * 100) / 100,
      }));
      const normalizedParts = normalizedEntries.map(d => `${d.rawName} ${d.normalizedValue}%`).join(' + ');

      anomalies.push({
        rowIndex: i,
        anomaly: {
          csvRowNumber: row.csvRowNumber,
          anomalyType: ANOMALY_TYPES.PERCENTAGE_SUM,
          severity: SEVERITY.WARNING,
          field: 'split_details',
          originalValue: `${originalParts} = ${roundedTotal}%`,
          resolvedValue: `${normalizedParts} = 100% (scaled proportionally)`,
          description: `Percentages sum to ${roundedTotal}% instead of 100%. Normalized proportionally.`,
          actionTaken: ACTION.AUTO_FIXED,
        },
        normalizedPercentages: normalizedEntries,
      });
    }
  }

  return anomalies;
}

// =============================================================================
// 7. Unequal Sum Mismatch
// =============================================================================
// For "unequal" split type, verify that the explicit amounts sum to the total.

function detectUnequalSumMismatch(parsedRows) {
  const anomalies = [];

  for (let i = 0; i < parsedRows.length; i++) {
    const row = parsedRows[i];
    const { splitType, splitDetails, amount } = row.parsed;

    if (splitType !== 'unequal' || !splitDetails.length || amount === null) continue;

    const splitSum = splitDetails.reduce((sum, d) => sum + d.value, 0);
    const roundedSum = Math.round(splitSum * 100) / 100;
    const roundedAmount = Math.round(Math.abs(amount) * 100) / 100;

    if (Math.abs(roundedSum - roundedAmount) > 0.01) {
      anomalies.push({
        rowIndex: i,
        anomaly: {
          csvRowNumber: row.csvRowNumber,
          anomalyType: ANOMALY_TYPES.UNEQUAL_SUM_MISMATCH,
          severity: SEVERITY.ERROR,
          field: 'split_details',
          originalValue: `split amounts: ${splitDetails.map(d => d.value).join('+')}=${roundedSum}, expense total=${roundedAmount}, difference=${Math.abs(roundedSum - roundedAmount).toFixed(2)}`,
          resolvedValue: `flagged for user review — amounts not auto-adjusted`,
          description: `Unequal split amounts sum to ${roundedSum} but expense total is ${roundedAmount}. Difference: ${Math.abs(roundedSum - roundedAmount).toFixed(2)}`,
          actionTaken: ACTION.FLAGGED,
        },
      });
    }
  }

  return anomalies;
}

// =============================================================================
// Main: runAnomalyDetection()
// =============================================================================
// Takes parsed rows (from csv-parser), runs all cross-row checks, and returns
// the enriched rows with anomalies appended + metadata about what was detected.

function runAnomalyDetection(parsedRows) {
  // Run all detectors
  const duplicates = detectDuplicates(parsedRows);
  const probableDuplicates = detectProbableDuplicates(parsedRows);
  const settlements = detectSettlements(parsedRows);
  const staleMemberships = detectStaleMemberships(parsedRows);
  const guests = detectGuestParticipants(parsedRows);
  const percentageIssues = detectPercentageSumIssues(parsedRows);
  const unequalMismatches = detectUnequalSumMismatch(parsedRows);

  // Combine all anomalies
  const allDetectedAnomalies = [
    ...duplicates,
    ...probableDuplicates,
    ...settlements,
    ...staleMemberships,
    ...guests,
    ...percentageIssues,
    ...unequalMismatches,
  ];

  // Append anomalies to the corresponding rows
  for (const detection of allDetectedAnomalies) {
    const row = parsedRows[detection.rowIndex];
    row.anomalies.push(detection.anomaly);

    // Mark rows that should be soft-deleted (exact duplicates)
    if (detection.markDeleted) {
      row.isDeleted = true;
    }

    // Mark rows that are settlements (not expenses)
    if (detection.isSettlement) {
      row.isSettlement = true;
      row.settlementData = detection.settlementData;
    }

    // Record excluded participants (stale membership)
    if (detection.excludeParticipant) {
      if (!row.excludedParticipants) row.excludedParticipants = [];
      row.excludedParticipants.push(detection.excludeParticipant);
    }

    // Record normalized percentages
    if (detection.normalizedPercentages) {
      row.normalizedPercentages = detection.normalizedPercentages;
    }
  }

  // Build summary
  const summary = {
    totalRows: parsedRows.length,
    duplicatesFound: duplicates.length,
    probableDuplicatesFound: probableDuplicates.length,
    settlementsDetected: settlements.length,
    staleMemberships: staleMemberships.length,
    guestParticipants: guests.length,
    percentageIssues: percentageIssues.length,
    unequalMismatches: unequalMismatches.length,
    totalAnomalies: allDetectedAnomalies.length,
  };

  return { parsedRows, summary };
}

module.exports = {
  runAnomalyDetection,
  inferGroup,
  normalizeDescription,
  getMembershipStatus,
  // Export individual detectors for testing
  detectDuplicates,
  detectProbableDuplicates,
  detectSettlements,
  detectStaleMemberships,
  detectGuestParticipants,
  detectPercentageSumIssues,
  detectUnequalSumMismatch,
};
