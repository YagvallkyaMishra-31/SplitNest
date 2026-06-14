// =============================================================================
// Balance Engine — Derive balances from raw data
// =============================================================================
// This module NEVER stores a running balance. It derives everything from
// expense_splits and settlements every time, ensuring traceability.
//
// The core formula for "how much does A owe B in group G":
//
//   Step 1: SUM(expense_splits where A is charged AND B paid) = A owes B
//   Step 2: SUM(expense_splits where B is charged AND A paid) = B owes A
//   Step 3: SUM(settlements where A paid B) = A already paid back
//   Step 4: SUM(settlements where B paid A) = B already paid back
//   Net = (Step 1 - Step 2) - (Step 3 - Step 4)
//     If positive: A owes B this amount
//     If negative: B owes A |this amount|
//
// Why derive instead of store? See implementation_plan.md.
// Stored balances go stale when data changes. Derived = always correct.

const { Prisma } = require('@prisma/client');

// =============================================================================
// Get all balances for a group — who owes whom, how much
// =============================================================================
// Returns an array of { from, to, amount } objects representing net debts.

async function getGroupBalances(prisma, groupId) {
  // Get all non-deleted expenses in this group with their splits
  const expenses = await prisma.expense.findMany({
    where: {
      groupId,
      isDeleted: false,
      paidById: { not: null }, // Exclude expenses with unknown payer
    },
    include: {
      splits: {
        include: { user: { select: { id: true, name: true } } },
      },
      paidBy: { select: { id: true, name: true } },
    },
  });

  // Get all settlements in this group
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: {
      paidBy: { select: { id: true, name: true } },
      paidTo: { select: { id: true, name: true } },
    },
  });

  // Build a debt matrix: debts[A][B] = how much A owes B (from expenses only)
  const debts = new Map();

  function addDebt(fromId, toId, amount) {
    if (fromId === toId) return; // Can't owe yourself
    if (!debts.has(fromId)) debts.set(fromId, new Map());
    const current = debts.get(fromId).get(toId) || 0;
    debts.get(fromId).set(toId, current + parseFloat(amount));
  }

  // Process expenses: each split means that person owes the payer
  for (const expense of expenses) {
    for (const split of expense.splits) {
      // The split user owes the payer their share
      addDebt(split.userId, expense.paidById, parseFloat(split.amount));
    }
  }

  // Process settlements: reduce debt
  for (const settlement of settlements) {
    // The person who paid reduces their debt to the recipient
    addDebt(settlement.paidById, settlement.paidToId, -parseFloat(settlement.amount));
  }

  // Simplify: compute NET between each pair
  const userNames = new Map();
  for (const expense of expenses) {
    userNames.set(expense.paidBy.id, expense.paidBy.name);
    for (const split of expense.splits) {
      userNames.set(split.user.id, split.user.name);
    }
  }
  for (const settlement of settlements) {
    userNames.set(settlement.paidBy.id, settlement.paidBy.name);
    userNames.set(settlement.paidTo.id, settlement.paidTo.name);
  }

  const netBalances = [];
  const processed = new Set();

  for (const [fromId, toMap] of debts) {
    for (const [toId, amount] of toMap) {
      const pairKey = [fromId, toId].sort().join('|');
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);

      // Get reverse debt
      const reverseAmount = debts.get(toId)?.get(fromId) || 0;
      const net = amount - reverseAmount;

      if (Math.abs(net) > 0.01) {
        if (net > 0) {
          netBalances.push({
            from: { id: fromId, name: userNames.get(fromId) },
            to: { id: toId, name: userNames.get(toId) },
            amount: Math.round(net * 100) / 100,
          });
        } else {
          netBalances.push({
            from: { id: toId, name: userNames.get(toId) },
            to: { id: fromId, name: userNames.get(fromId) },
            amount: Math.round(Math.abs(net) * 100) / 100,
          });
        }
      }
    }
  }

  return netBalances;
}

// =============================================================================
// Get balance breakdown for a specific user — "show your work"
// =============================================================================
// Returns every expense_split and settlement that contributes to this user's
// balance, so they can trace exactly where each number comes from.

async function getUserBalanceBreakdown(prisma, groupId, userId) {
  // Get expenses where this user paid
  const expensesPaid = await prisma.expense.findMany({
    where: { groupId, paidById: userId, isDeleted: false },
    include: {
      splits: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: { date: 'asc' },
  });

  // Get expense splits where this user owes
  const splitsOwed = await prisma.expenseSplit.findMany({
    where: {
      userId,
      expense: { groupId, isDeleted: false, paidById: { not: userId } },
    },
    include: {
      expense: {
        include: { paidBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: { expense: { date: 'asc' } },
  });

  // Get settlements sent by this user
  const settlementsSent = await prisma.settlement.findMany({
    where: { groupId, paidById: userId },
    include: { paidTo: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' },
  });

  // Get settlements received by this user
  const settlementsReceived = await prisma.settlement.findMany({
    where: { groupId, paidToId: userId },
    include: { paidBy: { select: { id: true, name: true } } },
    orderBy: { date: 'asc' },
  });

  // Build per-person breakdown
  const perPerson = new Map();

  function getPersonEntry(personId, personName) {
    if (!perPerson.has(personId)) {
      perPerson.set(personId, {
        person: { id: personId, name: personName },
        theyOweMe: [],    // Expenses I paid that they share
        iOweThem: [],      // Expenses they paid that I share
        iPaidThem: [],     // Settlements I sent to them
        theyPaidMe: [],    // Settlements they sent to me
        netAmount: 0,
      });
    }
    return perPerson.get(personId);
  }

  // Expenses I paid → others owe me
  for (const expense of expensesPaid) {
    for (const split of expense.splits) {
      if (split.userId === userId) continue; // Skip my own share
      const entry = getPersonEntry(split.userId, split.user.name);
      entry.theyOweMe.push({
        date: expense.date,
        description: expense.description,
        amount: parseFloat(split.amount),
        csvRowNumber: expense.csvRowNumber,
      });
      entry.netAmount += parseFloat(split.amount);
    }
  }

  // Expenses others paid → I owe them
  for (const split of splitsOwed) {
    const payerId = split.expense.paidById;
    const payerName = split.expense.paidBy.name;
    const entry = getPersonEntry(payerId, payerName);
    entry.iOweThem.push({
      date: split.expense.date,
      description: split.expense.description,
      amount: parseFloat(split.amount),
      csvRowNumber: split.expense.csvRowNumber,
    });
    entry.netAmount -= parseFloat(split.amount);
  }

  // Settlements I sent → reduces what I owe
  for (const settlement of settlementsSent) {
    const entry = getPersonEntry(settlement.paidToId, settlement.paidTo.name);
    entry.iPaidThem.push({
      date: settlement.date,
      amount: parseFloat(settlement.amount),
      notes: settlement.notes,
    });
    entry.netAmount += parseFloat(settlement.amount);
  }

  // Settlements I received → reduces what they owe
  for (const settlement of settlementsReceived) {
    const entry = getPersonEntry(settlement.paidById, settlement.paidBy.name);
    entry.theyPaidMe.push({
      date: settlement.date,
      amount: parseFloat(settlement.amount),
      notes: settlement.notes,
    });
    entry.netAmount -= parseFloat(settlement.amount);
  }

  // Convert to array and round
  const breakdown = [...perPerson.values()].map(entry => ({
    ...entry,
    netAmount: Math.round(entry.netAmount * 100) / 100,
    // Positive = they owe me, Negative = I owe them
    direction: entry.netAmount > 0.01 ? 'they_owe_me' : entry.netAmount < -0.01 ? 'i_owe_them' : 'settled',
  }));

  // Overall summary
  const totalOwedToMe = breakdown
    .filter(b => b.direction === 'they_owe_me')
    .reduce((sum, b) => sum + b.netAmount, 0);
  const totalIOwe = breakdown
    .filter(b => b.direction === 'i_owe_them')
    .reduce((sum, b) => sum + Math.abs(b.netAmount), 0);

  return {
    userId,
    groupId,
    totalOwedToMe: Math.round(totalOwedToMe * 100) / 100,
    totalIOwe: Math.round(totalIOwe * 100) / 100,
    netBalance: Math.round((totalOwedToMe - totalIOwe) * 100) / 100,
    perPerson: breakdown,
  };
}

// =============================================================================
// Optimal Settlement Suggestions
// =============================================================================
// Given the current balances, suggest the minimum number of transactions
// to settle all debts. Uses a greedy algorithm:
//   1. Calculate each person's net balance (positive = owed, negative = owes)
//   2. Match largest creditor with largest debtor
//   3. Repeat until all balances are zero

async function getSettlementSuggestions(prisma, groupId) {
  const balances = await getGroupBalances(prisma, groupId);

  // Build net positions per person
  const netPositions = new Map();

  for (const balance of balances) {
    // balance.from owes balance.to
    const fromCurrent = netPositions.get(balance.from.id) || { id: balance.from.id, name: balance.from.name, net: 0 };
    fromCurrent.net -= balance.amount;
    netPositions.set(balance.from.id, fromCurrent);

    const toCurrent = netPositions.get(balance.to.id) || { id: balance.to.id, name: balance.to.name, net: 0 };
    toCurrent.net += balance.amount;
    netPositions.set(balance.to.id, toCurrent);
  }

  // Split into creditors (positive net) and debtors (negative net)
  let creditors = [...netPositions.values()]
    .filter(p => p.net > 0.01)
    .sort((a, b) => b.net - a.net); // Largest first

  let debtors = [...netPositions.values()]
    .filter(p => p.net < -0.01)
    .map(p => ({ ...p, net: Math.abs(p.net) }))
    .sort((a, b) => b.net - a.net); // Largest first

  const suggestions = [];

  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = creditors[0];
    const debtor = debtors[0];
    const amount = Math.min(creditor.net, debtor.net);

    suggestions.push({
      from: { id: debtor.id, name: debtor.name },
      to: { id: creditor.id, name: creditor.name },
      amount: Math.round(amount * 100) / 100,
    });

    creditor.net -= amount;
    debtor.net -= amount;

    if (creditor.net < 0.01) creditors.shift();
    if (debtor.net < 0.01) debtors.shift();
  }

  return suggestions;
}

module.exports = {
  getGroupBalances,
  getUserBalanceBreakdown,
  getSettlementSuggestions,
};
