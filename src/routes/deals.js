const express = require('express');
const router = express.Router();
const multer = require('multer');
const { verifyToken, isAdmin } = require('../middleware/auth');
const {
  getMyDeals,
  adminGetAllDeals,
  adminCreateDeal,
  adminGenerateProforma,
  adminGetProformaUrl,
  getDealProformaPdf,
  adminNegotiateDeal,
  adminFinalizeProforma,
  adminInitiateAndEmail,
  adminCancelNegotiation,
  adminUpdateStage,
  adminSetPrice,
  adminDeleteDeal,
  getNdaStatus,
  adminUploadNda,
  adminRemoveNda,
  completeDeal,
  adminUploadDocuments
} = require('../controllers/dealsController');

// Multer for NDA file uploads (PDF or images, max 10MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- USER ROUTES ---
router.get('/my', verifyToken, getMyDeals);
router.get('/:id/proforma-pdf', verifyToken, getDealProformaPdf);

// --- ADMIN ROUTES ---
router.get('/admin/all', verifyToken, isAdmin, adminGetAllDeals);
router.get('/admin/:id/proforma-pdf', verifyToken, isAdmin, getDealProformaPdf);
router.get('/admin/:id/proforma-url', verifyToken, isAdmin, adminGetProformaUrl);
router.post('/admin', verifyToken, isAdmin, adminCreateDeal);
router.post('/admin/:id/generate-proforma', verifyToken, isAdmin, adminGenerateProforma);
router.put('/admin/:id/negotiate', verifyToken, isAdmin, adminNegotiateDeal);
router.put('/admin/:id/finalize-proforma', verifyToken, isAdmin, adminFinalizeProforma);
router.post('/admin/:id/initiate-and-email', verifyToken, isAdmin, adminInitiateAndEmail);
router.put('/admin/:id/cancel-negotiation', verifyToken, isAdmin, adminCancelNegotiation);
router.put('/admin/:id/stage', verifyToken, isAdmin, adminUpdateStage);
router.put('/admin/:id/price', verifyToken, isAdmin, adminSetPrice);
router.put('/admin/:id/complete', verifyToken, isAdmin, completeDeal);
router.delete('/admin/:id', verifyToken, isAdmin, adminDeleteDeal);

// --- NDA ROUTES ---
router.get('/admin/:id/nda', verifyToken, isAdmin, getNdaStatus);
router.post('/admin/:id/upload-nda', verifyToken, isAdmin, upload.single('nda'), adminUploadNda);
router.delete('/admin/:id/remove-nda', verifyToken, isAdmin, adminRemoveNda);

router.post('/admin/:id/upload-documents', verifyToken, isAdmin, upload.fields([
  { name: 'dispatch_doc', maxCount: 1 },
  { name: 'dispatch_photo', maxCount: 1 },
  { name: 'material_receipt', maxCount: 1 }
]), adminUploadDocuments);

module.exports = router;
