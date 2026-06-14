// =============================================================================
// Auth Routes — Register, Login, Logout, Me
// =============================================================================
// These are the 4 auth endpoints:
//   POST /api/auth/register — create a new account
//   POST /api/auth/login    — log in and get a JWT cookie
//   POST /api/auth/logout   — clear the JWT cookie
//   GET  /api/auth/me       — get the currently logged-in user's info
//
// Password flow:
//   Register: plaintext password → bcrypt.hash(password, 10) → store hash
//   Login:    plaintext password → bcrypt.compare(password, stored_hash) → yes/no
//
// Why bcrypt with saltRounds=10?
//   bcrypt is intentionally slow (~100ms per hash at 10 rounds). This makes
//   brute-force attacks impractical. The salt is embedded in the hash string,
//   so no separate salt column is needed.

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Number of bcrypt salt rounds. Higher = slower = more secure.
// 10 is the standard balance for web apps (~100ms per hash).
const SALT_ROUNDS = 10;

// JWT expiration time. After this, the user must log in again.
const TOKEN_EXPIRY = '24h';

// =============================================================================
// POST /api/auth/register — Create a new account
// =============================================================================
router.post('/register', async (req, res, next) => {
  try {
    const { email, password, name } = req.body;

    // --- Input validation ---
    // We check each field individually so the error message tells the user
    // exactly what's missing (not just "bad request").
    if (!email || !password || !name) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: {
          email: !email ? 'Email is required' : undefined,
          password: !password ? 'Password is required' : undefined,
          name: !name ? 'Name is required' : undefined,
        },
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters',
      });
    }

    // --- Check if email already exists ---
    const existingUser = await req.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // --- Hash the password ---
    // bcrypt.hash generates a random salt and hashes the password with it.
    // The result looks like: "$2a$10$N9qo8uLOickgx2ZMRZoMye..." (60 chars)
    // The salt is embedded in this string, so we don't store it separately.
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    // --- Create the user ---
    const user = await req.prisma.user.create({
      data: {
        email: email.toLowerCase(), // Normalize email to lowercase
        passwordHash,
        name: name.trim(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        // NEVER select passwordHash — it should never leave the server
      },
    });

    // --- Issue a JWT and set it as an httpOnly cookie ---
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.cookie('token', token, {
      httpOnly: true,      // JavaScript can't read this cookie (XSS protection)
      secure: process.env.NODE_ENV === 'production', // HTTPS only in production
      sameSite: 'lax',     // Prevents CSRF for most cases
      maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    });

    res.status(201).json({ user });
  } catch (error) {
    next(error); // Pass to global error handler
  }
});

// =============================================================================
// POST /api/auth/login — Log in with email + password
// =============================================================================
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // --- Find the user by email ---
    const user = await req.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (!user) {
      // Don't reveal whether the email exists — always say "invalid credentials"
      // to prevent email enumeration attacks.
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // --- Verify the password ---
    // bcrypt.compare hashes the input password with the same salt from the
    // stored hash and checks if they match.
    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // --- Issue JWT cookie ---
    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/auth/logout — Clear the JWT cookie
// =============================================================================
router.post('/logout', (req, res) => {
  // Clear the cookie by setting it to an empty value with maxAge=0.
  // The browser will immediately delete it.
  res.cookie('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0, // Expire immediately
  });

  res.json({ message: 'Logged out successfully' });
});

// =============================================================================
// GET /api/auth/me — Get the current user's info
// =============================================================================
// Protected route: requires the authenticate middleware to verify the JWT first.
// Used by the frontend to check "am I logged in?" on page load.
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await req.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
