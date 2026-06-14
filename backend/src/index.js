// =============================================================================
// Express Server Entry Point — src/index.js
// =============================================================================
// This is where the app starts. It:
//   1. Loads environment variables from .env
//   2. Creates the Express app with middleware
//   3. Mounts route handlers
//   4. Connects to the database via Prisma
//   5. Starts listening for HTTP requests
//
// Every middleware is explicitly listed here so you can trace the request
// pipeline in a code review: request → cors → json parser → cookie parser
// → routes → error handler.

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

// Load .env BEFORE anything else reads process.env
dotenv.config();

// Create the Prisma client — this is our database connection.
// We create ONE instance and share it across all route handlers.
// Why? Prisma maintains a connection pool internally; creating multiple
// clients would waste database connections.
const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3001;

// =============================================================================
// Middleware Pipeline
// =============================================================================

// CORS: Allow the React frontend (on a different port) to call our API.
// In development, the frontend runs on port 5173 (Vite default).
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true, // Required for cookies (JWT is in httpOnly cookie)
}));

// Parse JSON request bodies (e.g., POST /api/expenses with JSON data)
app.use(express.json());

// Parse cookies from incoming requests (we read the JWT from a cookie)
app.use(cookieParser());

// Make the Prisma client available to all route handlers via req.prisma
// This avoids importing prisma in every route file separately.
app.use((req, res, next) => {
  req.prisma = prisma;
  next();
});

// =============================================================================
// Routes
// =============================================================================

// Health check — useful for deployment platforms to verify the app is running
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth routes (register, login, logout, me)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Group routes (CRUD groups, members, balances)
const groupRoutes = require('./routes/groups');
app.use('/api/groups', groupRoutes);

// Expense routes (CRUD expenses with split calculation)
const expenseRoutes = require('./routes/expenses');
app.use('/api/expenses', expenseRoutes);

// Settlement routes (create, list direct payments)
const settlementRoutes = require('./routes/settlements');
app.use('/api/settlements', settlementRoutes);

// Import routes (upload CSV, review anomalies, approve/reject)
const importRoutes = require('./routes/import');
app.use('/api/import', importRoutes);

// =============================================================================
// Error Handling
// =============================================================================

// Global error handler — catches any unhandled errors from route handlers.
// Without this, Express returns a generic 500 with no useful info.
// We log the full error server-side but send a safe message to the client.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    // In development, include the stack trace for debugging
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

// =============================================================================
// Start Server
// =============================================================================

async function start() {
  try {
    // Verify database connection on startup
    await prisma.$connect();
    console.log('✓ Connected to PostgreSQL');

    app.listen(PORT, () => {
      console.log(`✓ Server running on http://localhost:${PORT}`);
      console.log(`  Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error);
    process.exit(1);
  }
}

start();

// Graceful shutdown — clean up the Prisma connection when the process exits
// (e.g., Ctrl+C in development, or a SIGTERM from the deployment platform)
process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
