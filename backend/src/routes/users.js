// =============================================================================
// User Routes — Search, list and create users
// =============================================================================
// GET  /api/users  — List all registered users (for group membership selection)
// POST /api/users  — Create a new user (for adding guest/new members)

const express = require('express');
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

// =============================================================================
// GET /api/users — List all registered users
// =============================================================================
router.get('/', async (req, res, next) => {
  try {
    const users = await req.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/users — Create a new user (without logging in or overriding session)
// =============================================================================
router.post('/', async (req, res, next) => {
  try {
    const { name, email, password } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Generate email if not provided (like ensureUsersExist)
    const targetEmail = email ? email.toLowerCase().trim() : `${name.toLowerCase().replace(/\s+/g, '')}@splitnest.local`;
    const targetPassword = password || 'password123';

    // Check if user with that email already exists
    const existing = await req.prisma.user.findUnique({
      where: { email: targetEmail },
    });

    if (existing) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(targetPassword, 10);

    const user = await req.prisma.user.create({
      data: {
        email: targetEmail,
        passwordHash,
        name: name.trim(),
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    res.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
