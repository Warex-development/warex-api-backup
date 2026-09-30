const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { verifyToken } = require('../middleware/auth');
const { publicFormLimiter } = require('../middleware/rateLimiter');
const { 
  uploadFile, 
  isStorageReady,
  uploadListingImage,
  uploadVatDocument,
  uploadAvatar,
  uploadListingDocument,
  uploadWarexpediaFile,
  uploadWarexpediaThumbnail
} = require('../services/storageService');
const pool = require('../config/database');

// ─── Multer Config ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

const uploadDocument = multer({
  storage: multer.memoryStorage(),
  limits : { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Health check (no auth) ────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    storageReady: isStorageReady(),
    message: isStorageReady()
      ? 'Supabase storage is configured and ready'
      : 'Supabase credentials missing — uploads will fail',
  });
});

/**
 * POST /api/uploads/listing-image
 * Upload a listing image (jpeg / png / webp, max 5 MB)
 * Body: multipart — field "image", field "listingId"
 */
router.post('/listing-image', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { listingId } = req.body;
    if (!listingId) {
      return res.status(400).json({ error: 'listingId is required' });
    }

    const { url } = await uploadListingImage(
      req.file.buffer,
      req.file.originalname,
      listingId,
      req.file.mimetype
    );

    return res.status(200).json({ url });
  } catch (error) {
    console.error('❌ [Upload] listing-image error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload image' });
  }
});

/**
 * POST /api/uploads/listing-document
 * Upload a listing technical document (pdf, max 10 MB)
 */
router.post('/listing-document', verifyToken, uploadDocument.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document provided' });
    }
    const { listingId } = req.body;
    if (!listingId) {
      return res.status(400).json({ error: 'listingId is required' });
    }

    const url = await uploadListingDocument(req.file.buffer, req.file.originalname, listingId, req.file.mimetype);
    
    return res.status(200).json({ url });
  } catch (error) {
    console.error('❌ [Upload] listing-document error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload document' });
  }
});

/**
 * POST /api/uploads/vat-document
 * Upload VAT/PAN document and record path in DB
 * Body: multipart — field "document"
 * Accepts: jpeg, png, webp, pdf
 */
router.post('/vat-document', verifyToken, upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No document provided' });
    }

    const { url, path } = await uploadVatDocument(
      req.file.buffer,
      req.file.originalname,
      req.user.id,
      req.file.mimetype
    );

    // Store public URL (prefer over raw path for retrieval)
    await pool.query(
      'UPDATE users SET vat_document_path = $1 WHERE id = $2',
      [url || path, req.user.id]
    );

    return res.status(200).json({ success: true, url, path });
  } catch (error) {
    console.error('❌ [Upload] vat-document error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload document' });
  }
});

/**
 * POST /api/uploads/avatar
 * Upload user avatar and update DB
 * Body: multipart — field "avatar"
 */
router.post('/avatar', verifyToken, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No avatar provided' });
    }

    const { url } = await uploadAvatar(
      req.file.buffer,
      req.file.originalname,
      req.user.id,
      req.file.mimetype
    );

    await pool.query(
      'UPDATE users SET avatar = $1 WHERE id = $2',
      [url, req.user.id]
    );

    return res.status(200).json({ url });
  } catch (error) {
    console.error('❌ [Upload] avatar error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload avatar' });
  }
});

/**
 * POST /api/uploads/vat-document-admin (admin only)
 * Admin uploads for member
 */
router.post('/vat-document-admin', verifyToken, upload.single('document'), async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: 'No document provided' });
    }

    const userId = req.body.userId || req.query.userId;
    if (!userId) {
      console.error('❌ [Upload] vat-document-admin: userId missing in body and query');
      return res.status(400).json({ error: 'userId is required' });
    }

    console.log(`📁 [Upload] Admin uploading for user: ${userId}`);

    const { url, path } = await uploadVatDocument(
      req.file.buffer,
      req.file.originalname,
      userId,
      req.file.mimetype
    );

    await pool.query(
      'UPDATE users SET vat_document_path = $1 WHERE id = $2',
      [url || path, userId]
    );

    return res.status(200).json({ url, path });
  } catch (error) {
    console.error('❌ [Upload] vat-document-admin error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload document' });
  }
});

/**
 * POST /api/uploads/warexpedia-file
 * Upload a WarexPedia document (no auth required)
 * Body: multipart — field "file"
 * Accepts: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX (max 20MB)
 */
const warexpediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

router.post('/warexpedia-file', publicFormLimiter, warexpediaUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const { url } = await uploadWarexpediaFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    const size_kb = Math.round(req.file.buffer.length / 1024);

    return res.status(200).json({ url, size_kb });
  } catch (error) {
    console.error('❌ [Upload] warexpedia-file error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload file' });
  }
});

/**
 * POST /api/uploads/warexpedia-thumbnail
 * Upload a WarexPedia document thumbnail (no auth required)
 * Body: multipart — field "thumbnail"
 * Accepts: JPEG, PNG, WEBP (max 10MB limit in default upload)
 */
router.post('/warexpedia-thumbnail', publicFormLimiter, upload.single('thumbnail'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No thumbnail provided' });
    }

    const { url } = await uploadWarexpediaThumbnail(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    return res.status(200).json({ url });
  } catch (error) {
    console.error('❌ [Upload] warexpedia-thumbnail error:', error.message);
    return res.status(500).json({ error: error.message || 'Failed to upload thumbnail' });
  }
});

module.exports = router;
