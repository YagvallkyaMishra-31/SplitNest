// =============================================================================
// Auth Middleware — JWT Token Verification
// =============================================================================
// This middleware sits in front of any route that requires a logged-in user.
// It reads the JWT from the httpOnly cookie, verifies it, and attaches the
// user's ID to req.user so route handlers can use it.
//
// How it works:
//   1. Look for a cookie named "token"
//   2. Verify it using the JWT_SECRET from .env
//   3. If valid → attach decoded payload to req.user, call next()
//   4. If missing or invalid → return 401 Unauthorized
//
// Why httpOnly cookie instead of Authorization header?
//   See DECISIONS.md D-003. httpOnly cookies can't be read by JavaScript,
//   which prevents XSS attacks from stealing the token.

const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  // Read the token from the cookie
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  }

  try {
    // jwt.verify throws an error if the token is expired or tampered with
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Attach the user's ID to the request object so routes can use it
    // (e.g., req.user.id to find "who is making this request?")
    req.user = { id: decoded.userId };

    next();
  } catch (error) {
    // Token is invalid (expired, wrong secret, corrupted)
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

module.exports = { authenticate };
