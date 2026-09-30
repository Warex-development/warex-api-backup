/**
 * warexpediaController.js
 * 
 * Handles all WarexPedia document CRUD operations.
 * All endpoints are public — no auth required.
 */

const pool = require('../config/database');
const jwt = require('jsonwebtoken');

/**
 * GET /api/warexpedia/documents
 * Query: ?page=1&limit=20&search=
 * Search matches against title and description.
 * Never returns contributor_email or contributor_phone.
 */
const getAllDocuments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const offset = (page - 1) * limit;

    let whereClause = "WHERE status = 'published'";
    const params = [];

    if (search) {
      const searchTerm = `%${search}%`;
      params.push(searchTerm);
      whereClause += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    const countQuery = `
      SELECT COUNT(DISTINCT COALESCE(upload_batch_id, id::text)) 
      FROM warexpedia_documents 
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    params.push(limit);
    params.push(offset);

    const dataResult = await pool.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (COALESCE(upload_batch_id, id::text)) 
                id, title, description, contributor_name, contributor_company,
                file_type, file_size_kb, thumbnail_url, views, downloads, verification_status, created_at, upload_batch_id, 
               SUM(helpful_yes) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as helpful_yes,
               SUM(helpful_no) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as helpful_no,
               COUNT(*) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as file_count,
                array_agg(verification_status) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as batch_statuses
         FROM warexpedia_documents
         ${whereClause}
       ) sub
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.status(200).json({
      data: dataResult.rows,
      page,
      limit,
      total,
      totalPages
    });
  } catch (error) {
    console.error('❌ [WarexPedia] getAllDocuments error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve documents' });
  }
};

/**
 * GET /api/warexpedia/documents/:id
 * Increments views by 1.
 * Returns full document details + file_url.
 * Never returns contributor_email or contributor_phone.
 */
const getDocumentById = async (req, res) => {
  try {
    const { id } = req.params;

    // Views are now tracked via a separate POST endpoint

    const result = await pool.query(
      `SELECT id, title, description, file_url, file_type, file_size_kb, thumbnail_url,
              contributor_name, contributor_company, user_id, upload_batch_id,
              views, downloads, helpful_yes, helpful_no, status, verification_status, created_at
       FROM warexpedia_documents
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    let doc = result.rows[0];
    
    // Fetch batch siblings
    if (doc.upload_batch_id) {
      const batchResult = await pool.query(
        `SELECT id, title, description, file_url, file_type, file_size_kb, thumbnail_url,
                contributor_name, contributor_company, user_id, upload_batch_id,
                views, downloads, helpful_yes, helpful_no, status, verification_status, created_at
         FROM warexpedia_documents
         WHERE upload_batch_id = $1
         ORDER BY id ASC`,
         [doc.upload_batch_id]
      );
      doc.batch_files = batchResult.rows;
    } else {
      doc.batch_files = [{...doc}];
    }

    return res.status(200).json(doc);
  } catch (error) {
    console.error('❌ [WarexPedia] getDocumentById error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve document' });
  }
};

/**
 * POST /api/warexpedia/documents
 * Body: title, description, file_url, file_type, file_size_kb,
 *       contributor_name, contributor_company, contributor_email,
 *       contributor_phone, user_id (optional)
 * Validates: title, file_url, contributor_name, contributor_email required.
 */
const createDocument = async (req, res) => {
  try {
    const {
      title, description, attachments,
      contributor_name, contributor_company, contributor_email,
      contributor_phone, user_id
    } = req.body;

    // Validation
    if (!title || !title.trim()) {
      return res.status(400).json({ message: 'Title is required' });
    }
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return res.status(400).json({ message: 'At least one file attachment is required' });
    }
    if (!contributor_name || !contributor_name.trim()) {
      return res.status(400).json({ message: 'Contributor name is required' });
    }
    if (!contributor_email || !contributor_email.trim()) {
      return res.status(400).json({ message: 'Contributor email is required' });
    }

    const crypto = require('crypto');
    const upload_batch_id = crypto.randomUUID();
    let firstId = null;

    for (const att of attachments) {
      const docTitle = title.trim();
      
      const result = await pool.query(
        `INSERT INTO warexpedia_documents 
          (title, description, file_url, thumbnail_url, file_type, file_size_kb, upload_batch_id,
           contributor_name, contributor_company, contributor_email,
           contributor_phone, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          docTitle, description?.trim() || null, att.file_url.trim(), att.thumbnail_url?.trim() || null,
          att.file_type || null, att.file_size_kb || null, upload_batch_id,
          contributor_name.trim(), contributor_company?.trim() || null,
          contributor_email.trim(), contributor_phone?.trim() || null,
          user_id || null
        ]
      );
      if (!firstId) firstId = result.rows[0].id;
    }

    return res.status(201).json({ id: firstId });
  } catch (error) {
    console.error('❌ [WarexPedia] createDocument error:', error.message);
    return res.status(500).json({ message: 'Failed to create document' });
  }
};

/**
 * POST /api/warexpedia/documents/:id/download
 * Increments downloads by 1.
 * Returns file_url for direct download.
 */
const trackDownload = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE warexpedia_documents 
       SET downloads = downloads + 1 
       WHERE id = $1 
       RETURNING file_url`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    return res.status(200).json({ file_url: result.rows[0].file_url });
  } catch (error) {
    console.error('❌ [WarexPedia] trackDownload error:', error.message);
    return res.status(500).json({ message: 'Failed to track download' });
  }
};

/**
 * POST /api/warexpedia/documents/:id/view
 * Increments views by 1.
 */
const trackView = async (req, res) => {
  try {
    const { id } = req.params;

    const docRes = await pool.query('SELECT upload_batch_id FROM warexpedia_documents WHERE id = $1', [id]);
    
    if (docRes.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const batchId = docRes.rows[0].upload_batch_id;

    if (batchId) {
      await pool.query(
        `UPDATE warexpedia_documents SET views = views + 1 WHERE upload_batch_id = $1`,
        [batchId]
      );
    } else {
      await pool.query(
        `UPDATE warexpedia_documents SET views = views + 1 WHERE id = $1`,
        [id]
      );
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ [WarexPedia] trackView error:', error.message);
    return res.status(500).json({ message: 'Failed to track view' });
  }
};

/**
 * POST /api/warexpedia/documents/:id/vote
 * Body: { voteType: 'yes' | 'no' }
 */
const voteHelpful = async (req, res) => {
  try {
    const { id } = req.params;
    const { voteType } = req.body;

    if (!['yes', 'no'].includes(voteType)) {
      return res.status(400).json({ message: 'Invalid voteType' });
    }

    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        userId = decoded.id;
      } catch (err) {
        // ignore invalid token
      }
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;

    let checkResult;
    if (userId) {
      checkResult = await pool.query(
        `SELECT id FROM warexpedia_document_votes WHERE document_id = $1 AND user_id = $2`,
        [id, userId]
      );
    } else {
      checkResult = await pool.query(
        `SELECT id FROM warexpedia_document_votes WHERE document_id = $1 AND ip_address = $2 AND user_id IS NULL`,
        [id, ip]
      );
    }

    if (checkResult.rows.length > 0) {
      return res.status(200).json({ already_voted: true });
    }

    if (userId) {
      await pool.query(
        `INSERT INTO warexpedia_document_votes (document_id, user_id, ip_address, vote) VALUES ($1, $2, $3, $4)`,
        [id, userId, ip, voteType]
      );
    } else {
      await pool.query(
        `INSERT INTO warexpedia_document_votes (document_id, ip_address, vote) VALUES ($1, $2, $3)`,
        [id, ip, voteType]
      );
    }

    const column = voteType === 'yes' ? 'helpful_yes' : 'helpful_no';

    const result = await pool.query(
      `UPDATE warexpedia_documents 
       SET ${column} = ${column} + 1 
       WHERE id = $1 
       RETURNING id, helpful_yes, helpful_no`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    return res.status(200).json({ success: true, ...result.rows[0] });
  } catch (error) {
    console.error('❌ [WarexPedia] voteHelpful error:', error.message);
    return res.status(500).json({ message: 'Failed to record vote' });
  }
};

module.exports = {
  getAllDocuments,
  getDocumentById,
  createDocument,
  trackDownload,
  trackView,
  voteHelpful
};
