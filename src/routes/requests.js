const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const {
  createRequest,
  createBulkRequests,
  getMyRequests,
  deleteRequest,
  adminGetAllRequests,
  adminGetRequestById,
  adminUpdateStatus,
  adminDeleteRequest
} = require('../controllers/requestsController');

// --- BUYER ROUTES ---
router.post('/', verifyToken, createRequest);
router.post('/bulk', verifyToken, createBulkRequests);
router.get('/my', verifyToken, getMyRequests);
router.delete('/:id', verifyToken, deleteRequest);

// --- ADMIN ROUTES ---
router.get('/admin/all', verifyToken, isAdmin, adminGetAllRequests);
router.get('/admin/detail/:id', verifyToken, isAdmin, adminGetRequestById);
router.get('/:id', verifyToken, isAdmin, adminGetRequestById);
router.put('/admin/:id/status', verifyToken, isAdmin, adminUpdateStatus);
router.delete('/admin/:id', verifyToken, isAdmin, adminDeleteRequest);

module.exports = router;
