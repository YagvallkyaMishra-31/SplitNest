// =============================================================================
// Group Routes — CRUD groups, manage members
// =============================================================================
// GET    /api/groups           — List all groups (with member counts)
// POST   /api/groups           — Create a new group
// GET    /api/groups/:id       — Get group details (members, membership history)
// PUT    /api/groups/:id       — Update group name/description
// POST   /api/groups/:id/members — Add a member
// PUT    /api/groups/:id/members/:userId — Update membership (set left_at)
// GET    /api/groups/:id/balances — Get group balances
// GET    /api/groups/:id/balances/:userId — Get user's balance breakdown

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getGroupBalances, getUserBalanceBreakdown, getSettlementSuggestions } = require('../services/balance-engine');

const router = express.Router();

// All group routes require authentication
router.use(authenticate);

// =============================================================================
// GET /api/groups — List all groups
// =============================================================================

router.get('/', async (req, res, next) => {
  try {
    const groups = await req.prisma.group.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        creator: { select: { id: true, name: true } },
        memberships: {
          include: { user: { select: { id: true, name: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        _count: { select: { expenses: true, settlements: true } },
      },
    });

    // Add active member count
    const result = groups.map(group => ({
      ...group,
      activeMemberCount: group.memberships.filter(m => !m.leftAt).length,
      totalMemberCount: group.memberships.length,
    }));

    res.json({ groups: result });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/groups — Create a new group
// =============================================================================

router.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const group = await req.prisma.group.create({
      data: {
        name,
        description: description || null,
        createdBy: req.user.id,
      },
      include: {
        creator: { select: { id: true, name: true } },
      },
    });

    // Auto-add the creator as a member
    await req.prisma.groupMembership.create({
      data: {
        groupId: group.id,
        userId: req.user.id,
        joinedAt: new Date(),
      },
    });

    res.status(201).json({ group });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/groups/:id — Get group details
// =============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const group = await req.prisma.group.findUnique({
      where: { id: req.params.id },
      include: {
        creator: { select: { id: true, name: true } },
        memberships: {
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: 'asc' },
        },
        expenses: {
          where: { isDeleted: false },
          orderBy: { date: 'desc' },
          take: 20,
          include: {
            paidBy: { select: { id: true, name: true } },
            splits: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
        settlements: {
          orderBy: { date: 'desc' },
          take: 10,
          include: {
            paidBy: { select: { id: true, name: true } },
            paidTo: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ group });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// PUT /api/groups/:id — Update group
// =============================================================================

router.put('/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const group = await req.prisma.group.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
      },
    });

    res.json({ group });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/groups/:id/members — Add a member to the group
// =============================================================================

router.post('/:id/members', async (req, res, next) => {
  try {
    const { userId, joinedAt } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const membership = await req.prisma.groupMembership.create({
      data: {
        groupId: req.params.id,
        userId,
        joinedAt: joinedAt ? new Date(joinedAt) : new Date(),
      },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ membership });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// PUT /api/groups/:id/members/:userId — Update membership (e.g., set left_at)
// =============================================================================

router.put('/:id/members/:userId', async (req, res, next) => {
  try {
    const { leftAt } = req.body;

    const membership = await req.prisma.groupMembership.findFirst({
      where: {
        groupId: req.params.id,
        userId: req.params.userId,
        leftAt: null, // Find active membership
      },
    });

    if (!membership) {
      return res.status(404).json({ error: 'Active membership not found' });
    }

    const updated = await req.prisma.groupMembership.update({
      where: { id: membership.id },
      data: { leftAt: leftAt ? new Date(leftAt) : new Date() },
      include: {
        user: { select: { id: true, name: true } },
      },
    });

    res.json({ membership: updated });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/groups/:id/balances — Get group balances
// =============================================================================

router.get('/:id/balances', async (req, res, next) => {
  try {
    const balances = await getGroupBalances(req.prisma, req.params.id);
    const suggestions = await getSettlementSuggestions(req.prisma, req.params.id);

    res.json({ balances, suggestions });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/groups/:id/balances/:userId — User's balance breakdown
// =============================================================================

router.get('/:id/balances/:userId', async (req, res, next) => {
  try {
    const breakdown = await getUserBalanceBreakdown(
      req.prisma, req.params.id, req.params.userId
    );

    res.json({ breakdown });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
