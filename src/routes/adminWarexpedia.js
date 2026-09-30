const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const {
  getAllAdminDocuments,
  verifyDocument,
  rejectDocument,
  deleteDocument
} = require('../controllers/adminWarexpediaController');

// All routes are protected
router.use(verifyToken, isAdmin);

// GET /api/admin/warexpedia
router.get('/', getAllAdminDocuments);

// PUT /api/admin/warexpedia/:id/verify
router.put('/:id/verify', verifyDocument);

// PUT /api/admin/warexpedia/:id/reject
router.put('/:id/reject', rejectDocument);

// DELETE /api/admin/warexpedia/:id
router.delete('/:id', deleteDocument);

module.exports = router;
