// =============================================================================
// Settlement Routes — Create, list, and manage direct payments
// =============================================================================
// GET  /api/settlements         — List settlements (with filters)
// POST /api/settlements         — Create a new settlement
// GET  /api/settlements/:id     — Get settlement details

const express = require('express');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// =============================================================================
// GET /api/settlements — List settlements with optional filters
// =============================================================================

router.get('/', async (req, res, next) => {
  try {
    const { groupId, userId, limit = 50, offset = 0 } = req.query;

    const where = {};
    if (groupId) where.groupId = groupId;
    if (userId) {
      where.OR = [{ paidById: userId }, { paidToId: userId }];
    }

    const [settlements, total] = await Promise.all([
      req.prisma.settlement.findMany({
        where,
        orderBy: { date: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: {
          paidBy: { select: { id: true, name: true } },
          paidTo: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
        },
      }),
      req.prisma.settlement.count({ where }),
    ]);

    res.json({ settlements, total });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/settlements — Create a new settlement
// =============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { groupId, paidById, paidToId, amount, date, notes } = req.body;

    if (!groupId || !paidToId || !amount) {
      return res.status(400).json({
        error: 'Missing required fields: groupId, paidToId, amount',
      });
    }

    const settlement = await req.prisma.settlement.create({
      data: {
        groupId,
        date: date ? new Date(date) : new Date(),
        paidById: paidById || req.user.id,
        paidToId,
        amount: parseFloat(amount),
        notes: notes || null,
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        paidTo: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ settlement });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/settlements/:id — Get settlement details
// =============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const settlement = await req.prisma.settlement.findUnique({
      where: { id: req.params.id },
      include: {
        paidBy: { select: { id: true, name: true } },
        paidTo: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
        importSession: { select: { id: true, filename: true, status: true } },
      },
    });

    if (!settlement) {
      return res.status(404).json({ error: 'Settlement not found' });
    }

    res.json({ settlement });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/users — List all users (needed for dropdowns, etc.)
// =============================================================================
// Placed here since there's no dedicated users route file

module.exports = router;
