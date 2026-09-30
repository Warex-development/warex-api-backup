/**
 * storageService.js
 *
 * Centralised Supabase Storage helper for WareX.
 *
 * Bucket names are configured via environment variables:
 *   SUPABASE_BUCKET_LISTINGS  (default: listing-images)
 *   SUPABASE_BUCKET_AVATARS   (default: avatars)
 *   SUPABASE_BUCKET_DOCS      (default: vat-documents)
 *
 * Exposed API:
 *   uploadFile({ buffer, originalname, mimetype, type, contextId })
 *     type      : 'listing' | 'avatar' | 'doc'
 *     contextId : listingId / userId — used as folder prefix
 *     returns   : { url, path }
 *
 *   Convenience wrappers (backward-compatible):
 *   uploadListingImage(buffer, fileName, listingId) → publicUrl string
 *   uploadAvatar(buffer, fileName, userId)          → publicUrl string
 *   uploadListingDocument(buffer, fileName, listingId) → publicUrl string
 */

const { createClient } = require('@supabase/supabase-js');

// ─── Supabase Client ──────────────────────────────────────────────────────────

let supabase = null;

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
  // Service Role Key use karo — RLS bypass hogi
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );
  console.log('✅ [Storage] Supabase storage client initialised with service role');
} else if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
  // Fallback to anon key
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  console.warn('⚠️ [Storage] Using anon key — uploads may fail due to RLS');
} else {
  console.warn('⚠️  [Storage] Supabase credentials missing — file uploads will fail.');
}

// ─── Bucket Map (env-driven, safe defaults) ───────────────────────────────────

const BUCKET_MAP = {
  listing    : () => process.env.SUPABASE_BUCKET_LISTINGS || 'listing-images',
  avatar     : () => process.env.SUPABASE_BUCKET_AVATARS  || 'avatars',
  doc        : () => process.env.SUPABASE_BUCKET_DOCS     || 'vat-documents',
  agreement  : () => process.env.SUPABASE_BUCKET_AGREEMENTS || 'deal-agreements',
  warexpedia : () => 'warexpedia-files',
  warexpedia_thumbnail : () => 'warexpedia-thumbnails',
};

// ─── Validation ───────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_DOC_TYPES   = ['image/jpeg', 'image/png', 'image/webp',
                              'application/pdf', 'application/msword',
                              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const ALLOWED_WAREXPEDIA_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp'
];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_SIZE_WAREXPEDIA = 20 * 1024 * 1024; // 20 MB

function verifyMagicBytes(buffer, mimetype) {
  if (!buffer || buffer.length < 4) return false;

  // JPEG: FF D8 FF
  if (mimetype === 'image/jpeg') {
    return buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
  }
  // PNG: 89 50 4E 47
  if (mimetype === 'image/png') {
    return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  }
  // WebP: RIFF .... WEBP
  if (mimetype === 'image/webp') {
    const isRiff = buffer.toString('ascii', 0, 4) === 'RIFF';
    const isWebp = buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP';
    return isRiff && isWebp;
  }
  // PDF: %PDF-
  if (mimetype === 'application/pdf') {
    return buffer.toString('ascii', 0, 5) === '%PDF-';
  }
  // Office OpenXML (docx, xlsx, pptx): PK\x03\x04
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  // Legacy MS Office (doc, xls, ppt): D0 CF 11 E0
  if (
    mimetype === 'application/msword' ||
    mimetype === 'application/vnd.ms-excel' ||
    mimetype === 'application/vnd.ms-powerpoint'
  ) {
    return buffer[0] === 0xD0 && buffer[1] === 0xCF && buffer[2] === 0x11 && buffer[3] === 0xE0;
  }

  return true;
}

function validateFile({ buffer, mimetype, type }) {
  if (!buffer || buffer.length === 0) {
    throw new Error('File buffer is empty');
  }
  const maxSize = type === 'warexpedia' ? MAX_SIZE_WAREXPEDIA : MAX_SIZE_BYTES;
  const maxLabel = type === 'warexpedia' ? '20 MB' : '10 MB';
  if (buffer.length > maxSize) {
    throw new Error(`File too large. Maximum allowed size is ${maxLabel} (received ${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
  }
  let allowed;
  if (type === 'warexpedia') allowed = ALLOWED_WAREXPEDIA_TYPES;
  else if (type === 'doc' || type === 'agreement') allowed = ALLOWED_DOC_TYPES;
  else if (type === 'warexpedia_thumbnail') allowed = ALLOWED_IMAGE_TYPES;
  else allowed = ALLOWED_IMAGE_TYPES;
  if (!allowed.includes(mimetype)) {
    throw new Error(`File type '${mimetype}' is not allowed. Accepted: ${allowed.join(', ')}`);
  }
  if (!verifyMagicBytes(buffer, mimetype)) {
    throw new Error(`File content signature does not match claimed MIME type '${mimetype}'. Upload rejected.`);
  }
}

// ─── Core Upload Helper ───────────────────────────────────────────────────────

/**
 * uploadFile — unified entry point for all uploads.
 *
 * @param {object} opts
 * @param {Buffer} opts.buffer        File buffer from multer
 * @param {string} opts.originalname  Original file name
 * @param {string} opts.mimetype      MIME type string
 * @param {'listing'|'avatar'|'doc'|'agreement'} opts.type  Upload category
 * @param {string} opts.contextId     Folder prefix (listingId or userId or dealId)
 * @param {string} opts.customPath    Exact storage path (e.g. proformas/uuid/WarexHub_Proforma-DEAL-9268.pdf)
 * @param {boolean} opts.isPrivate    Whether bucket/file is private
 * @returns {Promise<{url: string, path: string}>}
 */
async function uploadFile({ buffer, originalname, mimetype, type, contextId, customPath, isPrivate = false }) {
  if (!supabase) throw new Error('Supabase client not initialised. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');

  if (!BUCKET_MAP[type]) {
    throw new Error(`Unknown upload type '${type}'. Must be one of: ${Object.keys(BUCKET_MAP).join(', ')}`);
  }

  validateFile({ buffer, mimetype, type });

  const bucket = BUCKET_MAP[type]();
  const ext    = originalname.split('.').pop().toLowerCase();
  let path     = customPath;
  if (!path) {
    const prefix = contextId ? `${contextId}/` : '';
    path = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  }

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, { contentType: mimetype, upsert: true });

  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  let url;
  if (isPrivate || type === 'agreement') {
    // Generate signed URL (valid for 24 hours = 86400s)
    const { data: signedData, error: signedErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 86400);
    url = signedData?.signedUrl;
  } else {
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);
    url = urlData?.publicUrl;
  }

  console.log(`📁 [Storage] Uploaded ${type} → ${bucket}/${path}`);
  return { url: url || path, path, bucket };
}

/**
 * Generate a signed URL for a private file in storage
 */
async function getSignedFileUrl(type, filePath, expiresIn = 3600) {
  if (!supabase) throw new Error('Supabase client not initialised.');
  const bucket = BUCKET_MAP[type] ? BUCKET_MAP[type]() : type;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(filePath, expiresIn);
  if (error) throw error;
  return data?.signedUrl;
}

/**
 * Download file buffer directly from Supabase Storage
 */
async function downloadFileBuffer(type, filePath) {
  if (!supabase) throw new Error('Supabase client not initialised.');
  const bucket = BUCKET_MAP[type] ? BUCKET_MAP[type]() : type;
  const { data, error } = await supabase.storage.from(bucket).download(filePath);
  if (error) throw error;
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── Backward-Compatible Wrappers ─────────────────────────────────────────────
// These keep the uploads.js route untouched.

async function uploadListingImage(fileBuffer, fileName, listingId, mimetype) {
  return await uploadFile({
    buffer      : fileBuffer,
    originalname: fileName,
    mimetype    : mimetype || 'image/jpeg',
    type        : 'listing',
    contextId   : listingId,
  });
}

async function uploadVatDocument(fileBuffer, fileName, userId, mimetype) {
  return await uploadFile({
    buffer      : fileBuffer,
    originalname: fileName,
    mimetype    : mimetype || 'application/pdf',
    type        : 'doc',
    contextId   : userId,
  });
}

async function uploadAvatar(fileBuffer, fileName, userId, mimetype) {
  return await uploadFile({
    buffer      : fileBuffer,
    originalname: fileName,
    mimetype    : mimetype || 'image/jpeg',
    type        : 'avatar',
    contextId   : userId,
  });
}

async function uploadListingDocument(fileBuffer, fileName, listingId, mimetype) {
  if (!supabase) throw new Error('Supabase client not initialised.');
  
  const path = `${listingId}/document_${Date.now()}_${fileName}`;
  const { error } = await supabase.storage
    .from('listing-images')
    .upload(path, fileBuffer, {
      contentType: mimetype || 'application/pdf',
      upsert: true
    });
  if (error) throw error;
  const { data } = supabase.storage
    .from('listing-images')
    .getPublicUrl(path);
  return data.publicUrl;
}


async function uploadWarexpediaFile(fileBuffer, fileName, mimetype) {
  return await uploadFile({
    buffer      : fileBuffer,
    originalname: fileName,
    mimetype    : mimetype || 'application/pdf',
    type        : 'warexpedia',
    contextId   : 'warexpedia',
  });
}

async function uploadWarexpediaThumbnail(fileBuffer, fileName, mimetype) {
  return await uploadFile({
    buffer      : fileBuffer,
    originalname: fileName,
    mimetype    : mimetype || 'image/jpeg',
    type        : 'warexpedia_thumbnail',
    contextId   : 'warexpedia_thumbnails',
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Primary API
  uploadFile,
  getSignedFileUrl,
  downloadFileBuffer,
  // Backward-compatible wrappers (routes use these — do not remove)
  uploadListingImage,
  uploadVatDocument,
  uploadAvatar,
  uploadListingDocument,
  uploadWarexpediaFile,
  uploadWarexpediaThumbnail,
  // Expose for testing / diagnostics
  isStorageReady: () => supabase !== null,
  getBucketName : (type) => BUCKET_MAP[type]?.() || null,
};
