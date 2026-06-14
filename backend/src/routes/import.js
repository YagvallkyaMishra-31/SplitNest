// =============================================================================
// Import Routes — Upload CSV, review anomalies, approve/reject
// =============================================================================
// POST /api/import/upload     — Upload a CSV file and run the import pipeline
// GET  /api/import/:id        — Get import session details + anomalies
// GET  /api/import             — List all import sessions
// POST /api/import/:id/approve — Approve a pending import
// POST /api/import/:id/reject  — Reject a pending import

const express = require('express');
const { authenticate } = require('../middleware/auth');
const { processCSVImport, approveImport, rejectImport } = require('../services/import-service');

const router = express.Router();

// All import routes require authentication
router.use(authenticate);

// =============================================================================
// POST /api/import/upload — Upload and process a CSV file
// =============================================================================
// Expects: { csvText: string, filename: string }
// The frontend reads the file client-side and sends the text content.
// Why not multipart? Simpler for a demo app, and the CSV is small (~4KB).

router.post('/upload', async (req, res, next) => {
  try {
    const { csvText, filename } = req.body;

    if (!csvText) {
      return res.status(400).json({ error: 'csvText is required' });
    }

    const report = await processCSVImport(
      req.prisma,
      csvText,
      filename || 'upload.csv',
      req.user.id
    );

    res.status(201).json(report);
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/import — List all import sessions
// =============================================================================

router.get('/', async (req, res, next) => {
  try {
    const sessions = await req.prisma.importSession.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        importedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        _count: { select: { anomalies: true, expenses: true, settlements: true } },
      },
    });

    res.json({ sessions });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// GET /api/import/:id — Get a specific import session with full anomaly report
// =============================================================================

router.get('/:id', async (req, res, next) => {
  try {
    const session = await req.prisma.importSession.findUnique({
      where: { id: req.params.id },
      include: {
        importedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        anomalies: {
          orderBy: { csvRowNumber: 'asc' },
        },
        expenses: {
          where: { isDeleted: false },
          orderBy: { csvRowNumber: 'asc' },
          include: {
            paidBy: { select: { id: true, name: true } },
            splits: {
              include: { user: { select: { id: true, name: true } } },
            },
          },
        },
        settlements: {
          orderBy: { csvRowNumber: 'asc' },
          include: {
            paidBy: { select: { id: true, name: true } },
            paidTo: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({ error: 'Import session not found' });
    }

    res.json({ session });
  } catch (error) {
    next(error);
  }
});

// =============================================================================
// POST /api/import/:id/approve — Approve a pending import
// =============================================================================

router.post('/:id/approve', async (req, res, next) => {
  try {
    const result = await approveImport(req.prisma, req.params.id, req.user.id);
    res.json(result);
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Cannot')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

// =============================================================================
// POST /api/import/:id/reject — Reject a pending import
// =============================================================================

router.post('/:id/reject', async (req, res, next) => {
  try {
    const result = await rejectImport(req.prisma, req.params.id);
    res.json(result);
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Cannot')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

module.exports = router;
