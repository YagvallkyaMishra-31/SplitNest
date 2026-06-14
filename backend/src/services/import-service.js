// =============================================================================
// Import Service — Full CSV Import Pipeline Orchestrator
// =============================================================================
// This is the brain of the import system. It coordinates:
//   Stage 1: csv-parser.js   → Parse + normalize each row
//   Stage 2: anomaly-detector.js → Cross-row validation
//   Stage 3: THIS FILE        → Persist to database (users, groups, memberships,
//                                expenses, splits, settlements, anomalies)
//
// The import is a TWO-STEP workflow:
//   1. Upload & Validate (this function) → creates import_session in "pending" status
//   2. Approve (separate function) → flips status to "approved"
//
// Everything is created in one database transaction so if anything fails,
// nothing is partially committed.

const { parseCSV } = require('./csv-parser');
const { runAnomalyDetection, inferGroup } = require('./anomaly-detector');
const {
  FLAT_MEMBERSHIPS,
  GOA_MEMBERSHIPS,
  GOA_TRIP_MEMBERS,
  CANONICAL_NAMES,
  DECIMAL_PLACES,
  ANOMALY_TYPES,
} = require('../config/constants');

// =============================================================================
// Split Calculator — compute each person's share of an expense
// =============================================================================
// This is where the actual money math happens. Given an expense amount,
// split type, participants, and split details, compute each person's share.
//
// Rounding policy (D-006):
//   - Round each share to 2 decimal places
//   - For equal splits, assign the remainder to the FIRST participant
//     (who is typically the payer — this avoids pennies getting lost)

function calculateSplits(amount, splitType, participants, splitDetails, normalizedPercentages) {
  const splits = [];
  const absAmount = Math.abs(amount);
  const isNegative = amount < 0;

  if (!participants.length) return splits;

  switch (splitType) {
    case 'equal': {
      // Each person pays total / n, remainder goes to first person
      const perPerson = Math.floor((absAmount / participants.length) * 100) / 100;
      const remainder = Math.round((absAmount - perPerson * participants.length) * 100) / 100;

      participants.forEach((name, idx) => {
        let share = perPerson;
        if (idx === 0) share = Math.round((perPerson + remainder) * 100) / 100;
        splits.push({
          userName: name,
          amount: isNegative ? -share : share,
          shareValue: 1, // Equal share = 1 unit each
        });
      });
      break;
    }

    case 'unequal': {
      // Each person's amount is explicitly specified in split_details
      for (const detail of splitDetails) {
        const resolvedName = participants.find(
          p => p.toLowerCase() === detail.rawName.toLowerCase()
        ) || detail.rawName;

        splits.push({
          userName: resolvedName,
          amount: isNegative ? -detail.value : detail.value,
          shareValue: detail.value,
        });
      }
      break;
    }

    case 'percentage': {
      // Use normalized percentages if available (anomaly detector fixed them)
      const entries = normalizedPercentages || splitDetails;

      for (const detail of entries) {
        const pct = detail.normalizedValue || detail.value;
        const share = Math.round((absAmount * pct / 100) * 100) / 100;
        const resolvedName = participants.find(
          p => p.toLowerCase() === detail.rawName.toLowerCase()
        ) || detail.rawName;

        splits.push({
          userName: resolvedName,
          amount: isNegative ? -share : share,
          shareValue: pct,
        });
      }
      break;
    }

    case 'share': {
      // Ratio-based: each person gets (their shares / total shares) × amount
      const totalShares = splitDetails.reduce((sum, d) => sum + d.value, 0);
      if (totalShares === 0) break;

      for (const detail of splitDetails) {
        const share = Math.round((absAmount * detail.value / totalShares) * 100) / 100;
        const resolvedName = participants.find(
          p => p.toLowerCase() === detail.rawName.toLowerCase()
        ) || detail.rawName;

        splits.push({
          userName: resolvedName,
          amount: isNegative ? -share : share,
          shareValue: detail.value,
        });
      }
      break;
    }

    default: {
      // No split type or unrecognized — default to equal if participants exist
      if (participants.length > 0) {
        const perPerson = Math.floor((absAmount / participants.length) * 100) / 100;
        const remainder = Math.round((absAmount - perPerson * participants.length) * 100) / 100;

        participants.forEach((name, idx) => {
          let share = perPerson;
          if (idx === 0) share = Math.round((perPerson + remainder) * 100) / 100;
          splits.push({
            userName: name,
            amount: isNegative ? -share : share,
            shareValue: 1,
          });
        });
      }
    }
  }

  return splits;
}

// =============================================================================
// Ensure Users Exist — create user records for all names in the CSV
// =============================================================================
// During import, we need real user IDs for foreign keys. This function
// creates user records for any canonical name that doesn't already exist.
// Password is set to a bcrypt hash of "password123" — these are CSV-imported
// users, not real registrations. They can change their password later.

async function ensureUsersExist(prisma, names) {
  const bcrypt = require('bcryptjs');
  const userMap = new Map(); // name → user record

  for (const name of names) {
    // Check if user already exists (by name, case-insensitive)
    let user = await prisma.user.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (!user) {
      // Create with a default email and password
      const email = `${name.toLowerCase()}@splitnest.local`;
      const passwordHash = await bcrypt.hash('password123', 10);

      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
        },
      });
    }

    userMap.set(name, user);
  }

  return userMap;
}

// =============================================================================
// Ensure Groups Exist — create Flat and Goa groups + memberships
// =============================================================================

async function ensureGroupsExist(prisma, creatorId) {
  const groupMap = new Map();

  // Create or find the Flat group
  let flatGroup = await prisma.group.findFirst({
    where: { name: 'Flat 4B' },
  });
  if (!flatGroup) {
    flatGroup = await prisma.group.create({
      data: {
        name: 'Flat 4B',
        description: 'Shared apartment expenses',
        createdBy: creatorId,
      },
    });
  }
  groupMap.set('Flat', flatGroup);

  // Create or find the Goa Trip group
  let goaGroup = await prisma.group.findFirst({
    where: { name: 'Goa Trip' },
  });
  if (!goaGroup) {
    goaGroup = await prisma.group.create({
      data: {
        name: 'Goa Trip',
        description: 'Goa vacation March 2026',
        createdBy: creatorId,
      },
    });
  }
  groupMap.set('Goa', goaGroup);

  return groupMap;
}

// =============================================================================
// Ensure Memberships Exist
// =============================================================================

async function ensureMembershipsExist(prisma, groupMap, userMap) {
  // Flat memberships
  const flatGroup = groupMap.get('Flat');
  for (const membership of FLAT_MEMBERSHIPS) {
    const user = userMap.get(membership.name);
    if (!user) continue;

    const existing = await prisma.groupMembership.findFirst({
      where: {
        groupId: flatGroup.id,
        userId: user.id,
        joinedAt: new Date(membership.joinedAt),
      },
    });

    if (!existing) {
      await prisma.groupMembership.create({
        data: {
          groupId: flatGroup.id,
          userId: user.id,
          joinedAt: new Date(membership.joinedAt),
          leftAt: membership.leftAt ? new Date(membership.leftAt) : null,
        },
      });
    }
  }

  // Goa memberships
  const goaGroup = groupMap.get('Goa');
  for (const membership of GOA_MEMBERSHIPS) {
    const user = userMap.get(membership.name);
    if (!user) continue;

    const existing = await prisma.groupMembership.findFirst({
      where: {
        groupId: goaGroup.id,
        userId: user.id,
        joinedAt: new Date(membership.joinedAt),
      },
    });

    if (!existing) {
      await prisma.groupMembership.create({
        data: {
          groupId: goaGroup.id,
          userId: user.id,
          joinedAt: new Date(membership.joinedAt),
          leftAt: membership.leftAt ? new Date(membership.leftAt) : null,
        },
      });
    }
  }
}

// =============================================================================
// Main: processCSVImport()
// =============================================================================
// The full import pipeline. Returns a structured report suitable for the
// frontend's import review screen.

async function processCSVImport(prisma, csvText, filename, importedById) {
  // --- Stage 1: Parse ---
  const parsedRows = parseCSV(csvText);

  // --- Stage 2: Detect anomalies ---
  const { parsedRows: enrichedRows, summary } = runAnomalyDetection(parsedRows);

  // --- Stage 3: Persist to database ---

  // Collect all unique names from the CSV
  const allNames = new Set();
  for (const row of enrichedRows) {
    if (row.parsed.paidBy) allNames.add(row.parsed.paidBy);
    for (const p of row.parsed.participants) allNames.add(p);
  }

  // Ensure all users exist
  const userMap = await ensureUsersExist(prisma, [...allNames]);

  // Ensure groups + memberships exist
  const groupMap = await ensureGroupsExist(prisma, importedById);
  await ensureMembershipsExist(prisma, groupMap, userMap);

  // Create the import session
  const importSession = await prisma.importSession.create({
    data: {
      filename,
      status: 'pending',
      totalRows: enrichedRows.length,
      importedById,
    },
  });

  // Collect all anomalies for bulk insert
  const allAnomalies = [];
  let importedCount = 0;
  let settlementCount = 0;

  // Process each row
  for (const row of enrichedRows) {
    // Add row-level anomalies to the collection
    for (const anomaly of row.anomalies) {
      allAnomalies.push({
        importSessionId: importSession.id,
        csvRowNumber: anomaly.csvRowNumber,
        anomalyType: anomaly.anomalyType,
        severity: anomaly.severity,
        field: anomaly.field || null,
        originalValue: anomaly.originalValue || null,
        resolvedValue: anomaly.resolvedValue || null,
        description: anomaly.description,
        actionTaken: anomaly.actionTaken,
      });
    }

    // Skip rows with no date or no parseable data
    if (!row.parsed.date) continue;

    // Determine which group this expense belongs to
    const group = inferGroup(row);
    const groupRecord = groupMap.get(group);

    // --- Handle settlements ---
    if (row.isSettlement && row.settlementData) {
      const payer = userMap.get(row.settlementData.paidBy);
      const recipient = userMap.get(row.settlementData.paidTo);

      if (payer && recipient && groupRecord) {
        await prisma.settlement.create({
          data: {
            groupId: groupRecord.id,
            date: new Date(row.parsed.date),
            paidById: payer.id,
            paidToId: recipient.id,
            amount: row.settlementData.amount,
            notes: row.parsed.notes || null,
            importSessionId: importSession.id,
            csvRowNumber: row.csvRowNumber,
          },
        });
        settlementCount++;
      }
      continue; // Don't also create an expense for settlement rows
    }

    // --- Handle expenses ---
    // Filter out excluded participants (stale members)
    let activeParticipants = row.parsed.participants;
    if (row.excludedParticipants) {
      activeParticipants = activeParticipants.filter(
        p => !row.excludedParticipants.includes(p)
      );
    }

    // Calculate splits
    const splits = calculateSplits(
      row.parsed.amount,
      row.parsed.splitType,
      activeParticipants,
      row.parsed.splitDetails,
      row.normalizedPercentages
    );

    // Resolve payer
    const payer = row.parsed.paidBy ? userMap.get(row.parsed.paidBy) : null;

    if (groupRecord) {
      const expense = await prisma.expense.create({
        data: {
          groupId: groupRecord.id,
          date: new Date(row.parsed.date),
          description: row.parsed.description,
          paidById: payer ? payer.id : null,
          amount: Math.abs(row.parsed.amount || 0),
          originalAmount: Math.abs(row.parsed.originalAmount || row.parsed.amount || 0),
          originalCurrency: row.parsed.originalCurrency || 'INR',
          currency: row.parsed.currency || 'INR',
          exchangeRate: row.parsed.exchangeRate || 1.0,
          splitType: row.parsed.splitType || 'equal',
          notes: row.parsed.notes || null,
          isDeleted: row.isDeleted || false,
          importSessionId: importSession.id,
          csvRowNumber: row.csvRowNumber,
        },
      });

      // Create splits
      for (const split of splits) {
        const splitUser = userMap.get(split.userName);
        if (splitUser) {
          await prisma.expenseSplit.create({
            data: {
              expenseId: expense.id,
              userId: splitUser.id,
              amount: Math.abs(split.amount),
              shareValue: split.shareValue,
            },
          });
        }
      }

      importedCount++;
    }
  }

  // Bulk insert anomalies
  if (allAnomalies.length > 0) {
    await prisma.importAnomaly.createMany({
      data: allAnomalies,
    });
  }

  // Update import session counts
  await prisma.importSession.update({
    where: { id: importSession.id },
    data: {
      importedCount,
      anomalyCount: allAnomalies.length,
    },
  });

  // Build the report
  const report = {
    importSessionId: importSession.id,
    filename,
    status: 'pending',
    summary: {
      totalRows: enrichedRows.length,
      importedAsExpenses: importedCount,
      importedAsSettlements: settlementCount,
      duplicatesDropped: enrichedRows.filter(r => r.isDeleted).length,
      anomalyCount: allAnomalies.length,
      ...summary,
    },
    anomalies: allAnomalies.map(a => ({
      csvRowNumber: a.csvRowNumber,
      anomalyType: a.anomalyType,
      severity: a.severity,
      field: a.field,
      originalValue: a.originalValue,
      resolvedValue: a.resolvedValue,
      description: a.description,
      actionTaken: a.actionTaken,
    })),
    rows: enrichedRows.map(row => ({
      csvRowNumber: row.csvRowNumber,
      raw: row.raw,
      parsed: row.parsed,
      anomalyCount: row.anomalies.length,
      isDeleted: row.isDeleted || false,
      isSettlement: row.isSettlement || false,
    })),
  };

  return report;
}

// =============================================================================
// Approve Import Session
// =============================================================================

async function approveImport(prisma, importSessionId, approvedById) {
  const session = await prisma.importSession.findUnique({
    where: { id: importSessionId },
  });

  if (!session) throw new Error('Import session not found');
  if (session.status !== 'pending') throw new Error(`Cannot approve session with status "${session.status}"`);

  await prisma.importSession.update({
    where: { id: importSessionId },
    data: {
      status: 'approved',
      approvedById,
      approvedAt: new Date(),
    },
  });

  return { status: 'approved', importSessionId };
}

// =============================================================================
// Reject Import Session — soft-delete all imported data
// =============================================================================

async function rejectImport(prisma, importSessionId) {
  const session = await prisma.importSession.findUnique({
    where: { id: importSessionId },
  });

  if (!session) throw new Error('Import session not found');
  if (session.status !== 'pending') throw new Error(`Cannot reject session with status "${session.status}"`);

  // Soft-delete all expenses from this session
  await prisma.expense.updateMany({
    where: { importSessionId },
    data: { isDeleted: true },
  });

  // Delete settlements from this session
  await prisma.settlement.deleteMany({
    where: { importSessionId },
  });

  await prisma.importSession.update({
    where: { id: importSessionId },
    data: { status: 'rejected' },
  });

  return { status: 'rejected', importSessionId };
}

module.exports = {
  processCSVImport,
  approveImport,
  rejectImport,
  calculateSplits,
  ensureUsersExist,
};
