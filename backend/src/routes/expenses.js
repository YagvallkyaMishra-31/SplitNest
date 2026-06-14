// =============================================================================
// Expense Routes — CRUD expenses with split calculation
// =============================================================================
// GET    /api/expenses         — List expenses (with filters)
// POST   /api/expenses         — Create a new expense
// GET    /api/expenses/:id     — Get expense details with splits
// PUT    /api/expenses/:id     — Update an expense
// DELETE /api/expenses/:id     — Soft-delete an expense

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { calculateSplits } = require('../services/import-service');

const router = express.Router();
router.use(authenticate);

// =============================================================================
// GET /api/expenses — List expenses with optional filters
// =============================================================================

router.get('/', async (req, res, next) => {
  try {
    const { groupId, startDate, endDate, paidById, limit = 50, offset = 0 } = req.query;

    const where = { isDeleted: false };
    if (groupId) where.groupId = groupId;
    if (paidById) where.paidById = paidById;
    if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = new Date(startDate);
      if (endDate) where.date.lte = new Date(endDate);
    }

    const [expenses, total] = await Promise.all([
      req.prisma.expense.findMany({
        where,
        orderBy: { date: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: {
          paidBy: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
          splits: {
            include: { user: { select: { id: true, name: true } } },
          },
        },
      }),
      req.prisma.expense.count({ where }),
    ]);

    res.json({ expenses, total, limit: parseInt(limit), offset: parseInt(offset) });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/expenses — Create a new expense
// =============================================================================

router.post('/', async (req, res, next) => {
  try {
    const {
      groupId, date, description, paidById, amount,
      splitType, participants, splitDetails, notes,
    } = req.body;

    if (!groupId || !date || !description || !amount) {
      return res.status(400).json({
        error: 'Missing required fields: groupId, date, description, amount',
      });
    }

    // Calculate splits
    const parsedDetails = splitDetails || [];
    const splits = calculateSplits(
      parseFloat(amount), splitType || 'equal',
      participants || [], parsedDetails
    );

    const expense = await req.prisma.expense.create({
      data: {
        groupId,
        date: new Date(date),
        description,
        paidById: paidById || req.user.id,
        amount: Math.abs(parseFloat(amount)),
        originalAmount: Math.abs(parseFloat(amount)),
        originalCurrency: 'INR',
        currency: 'INR',
        exchangeRate: 1.0,
        splitType: splitType || 'equal',
        notes: notes || null,
        splits: {
          create: splits.map(s => ({
            userId: s.userId || s.userName, // userName should be mapped to userId by caller
            amount: Math.abs(s.amount),
            shareValue: s.shareValue,
          })),
        },
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        splits: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    res.status(201).json({ expense });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/expenses/:id — Get expense details
// =============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const expense = await req.prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        paidBy: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        splits: {
          include: { user: { select: { id: true, name: true } } },
        },
        importSession: { select: { id: true, filename: true, status: true } },
      },
    });

    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    res.json({ expense });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// PUT /api/expenses/:id — Update an expense
// =============================================================================

router.put('/:id', async (req, res, next) => {
  try {
    const { description, amount, splitType, notes } = req.body;

    const expense = await req.prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...(description && { description }),
        ...(amount && { amount: parseFloat(amount) }),
        ...(splitType && { splitType }),
        ...(notes !== undefined && { notes }),
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        splits: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    res.json({ expense });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// DELETE /api/expenses/:id — Soft-delete an expense
// =============================================================================

router.delete('/:id', async (req, res, next) => {
  try {
    await req.prisma.expense.update({
      where: { id: req.params.id },
      data: { isDeleted: true },
    });

    res.json({ message: 'Expense deleted' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
