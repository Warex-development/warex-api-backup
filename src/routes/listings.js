const express = require('express');
const router = express.Router();
const { verifyToken, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const {
  createListing,
  bulkUploadListings,
  getMyListings,
  updateListing,
  deleteListing,
  getListings,
  adminGetAllListings,
  adminGetPendingListings,
  adminApproveListing,
  adminRejectListing,
  adminCounterPrice,
  adminRequestCorrection,
  hideListing,
  unhideListing,
  adminDeleteListing,
  getListingById,
  adminGetListingById,
  adminEditListing,
  adminHideListing,
  adminUnhideListing,
  adminGetPendingUpdates,
  adminApproveUpdate,
  adminRejectUpdate,
  getPromotedListings,
  adminTogglePromoteListing,
} = require('../controllers/listingsController');

const { getCountByIndustry } = require('../controllers/publicStatsController');

// --- PUBLIC ROUTES (no auth required) ---
// GET /api/listings/count-by-industry — public, ~5-min cached
router.get('/count-by-industry', getCountByIndustry);
router.get('/promoted', getPromotedListings);


// --- ADMIN ROUTES (must come before :id wildcard routes) ---
// Phase 5: Admin approval flow
// GET  /api/listings/admin/pending       → pending queue
// GET  /api/listings/admin/all           → all listings (filterable by ?status=)
// PUT  /api/listings/admin/approve/:id   → approve listing
// PUT  /api/listings/admin/reject/:id    → reject listing
// PUT  /api/listings/admin/counter-price/:id → counter price
// PUT  /api/listings/admin/request-correction/:id → request correction
router.get('/admin/pending', verifyToken, isAdmin, adminGetPendingListings);
router.get('/admin/all', verifyToken, isAdmin, adminGetAllListings);
router.patch('/admin/promote/:id', verifyToken, isAdmin, adminTogglePromoteListing);
// Maker-Checker: Pending Updates (MUST be before /admin/:id wildcard)
router.get('/admin/pending-updates', verifyToken, isAdmin, adminGetPendingUpdates);
router.put('/admin/approve-update/:id', verifyToken, isAdmin, adminApproveUpdate);
router.put('/admin/reject-update/:id', verifyToken, isAdmin, adminRejectUpdate);
router.put('/admin/approve/:id', verifyToken, isAdmin, adminApproveListing);
router.put('/admin/reject/:id', verifyToken, isAdmin, adminRejectListing);
router.put('/admin/counter-price/:id', verifyToken, isAdmin, adminCounterPrice);
router.put('/admin/request-correction/:id', verifyToken, isAdmin, adminRequestCorrection);
router.put('/admin/edit/:id', verifyToken, isAdmin, adminEditListing);
router.put('/admin/:id/hide', verifyToken, isAdmin, adminHideListing);
router.put('/admin/:id/unhide', verifyToken, isAdmin, adminUnhideListing);
router.delete('/admin/:id', verifyToken, isAdmin, adminDeleteListing);
router.get('/admin/:id/detail', verifyToken, isAdmin, adminGetListingById);


// Alias routes: /api/admin/listings/* (mounted via server.js or via these aliases)
// Kept here so both /api/listings/admin/* and /api/admin/listings/* work
router.get('/admin-pending', verifyToken, isAdmin, adminGetPendingListings);
router.put('/admin-approve/:id', verifyToken, isAdmin, adminApproveListing);
router.put('/admin-reject/:id', verifyToken, isAdmin, adminRejectListing);

// --- SELLER ROUTES ---
// Phase 2: Manual listing — POST always forces status='pending'
router.post('/', verifyToken, createListing);
// Phase 3: Bulk upload — each row gets status='pending'
router.post('/bulk-upload', verifyToken, upload.single('file'), bulkUploadListings);
// Phase 6: Seller sees own listings (pending/approved/rejected)
router.get('/my', verifyToken, getMyListings);
router.put('/:id', verifyToken, updateListing);
router.delete('/:id', verifyToken, deleteListing);
router.put('/:id/hide', verifyToken, hideListing);
router.put('/:id/unhide', verifyToken, unhideListing);
router.get('/:id/detail', verifyToken, getListingById);

// --- BUYER ROUTES ---
// Phase 6: Buyer sees ONLY approved listings
router.get('/', getListings);

module.exports = router;
