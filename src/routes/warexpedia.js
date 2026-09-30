const express = require('express');
const router = express.Router();
const {
  getAllDocuments,
  getDocumentById,
  createDocument,
  trackDownload,
  trackView,
  voteHelpful
} = require('../controllers/warexpediaController');

// All routes are public — no auth required

// GET /api/warexpedia/documents?page=1&limit=20&search=
router.get('/documents', getAllDocuments);

// GET /api/warexpedia/documents/:id
router.get('/documents/:id', getDocumentById);

// POST /api/warexpedia/documents
router.post('/documents', createDocument);

// POST /api/warexpedia/documents/:id/download
router.post('/documents/:id/download', trackDownload);

// POST /api/warexpedia/documents/:id/view
router.post('/documents/:id/view', trackView);

// POST /api/warexpedia/documents/:id/vote
router.post('/documents/:id/vote', voteHelpful);

module.exports = router;
