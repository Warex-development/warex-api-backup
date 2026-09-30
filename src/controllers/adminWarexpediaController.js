const pool = require('../config/database');

const getAllAdminDocuments = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const search = req.query.search || '';
    const status = req.query.status || 'all'; // all, verified, rejected, not_verified
    const offset = (page - 1) * limit;

    let whereClause = "WHERE 1=1";
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      whereClause += ` AND (title ILIKE $${params.length} OR contributor_name ILIKE $${params.length})`;
    }

    if (status !== 'all') {
      if (status === 'partially_verified') {
        whereClause += ` AND 'verified' = ANY(batch_statuses) AND ( 'rejected' = ANY(batch_statuses) OR 'not_verified' = ANY(batch_statuses) OR array_position(batch_statuses, NULL) IS NOT NULL )`;
      } else if (status === 'verified') {
        params.push('verified');
        whereClause += ` AND $${params.length} = ALL(batch_statuses)`;
      } else if (status === 'rejected') {
        params.push('rejected');
        whereClause += ` AND $${params.length} = ALL(batch_statuses)`;
      } else if (status === 'not_verified') {
        whereClause += ` AND NOT ('verified' = ANY(batch_statuses)) AND NOT ('rejected' = ANY(batch_statuses))`;
      }
    }

    const countQuery = `
      WITH BatchAgg AS (
        SELECT DISTINCT ON (COALESCE(upload_batch_id, id::text)) 
               title, contributor_name,
               array_agg(verification_status) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as batch_statuses
        FROM warexpedia_documents
      )
      SELECT COUNT(*) FROM BatchAgg 
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit) || 1;

    params.push(limit);
    params.push(offset);

    const dataQuery = `
      WITH BatchAgg AS (
        SELECT DISTINCT ON (COALESCE(upload_batch_id, id::text)) 
               id, title, file_url, file_type, contributor_name, contributor_company,
               contributor_email, contributor_phone, verification_status, created_at,
               upload_batch_id,
               SUM(helpful_yes) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as helpful_yes,
               SUM(helpful_no) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as helpful_no,
               COUNT(*) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as file_count,
               array_agg(verification_status) OVER (PARTITION BY COALESCE(upload_batch_id, id::text)) as batch_statuses
        FROM warexpedia_documents
      )
      SELECT * FROM BatchAgg
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const dataResult = await pool.query(dataQuery, params);

    return res.status(200).json({
      data: dataResult.rows,
      page,
      limit,
      total,
      totalPages
    });
  } catch (error) {
    console.error('❌ [AdminWarexPedia] getAllAdminDocuments error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve documents' });
  }
};

const verifyDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE warexpedia_documents SET verification_status = 'verified' WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Document not found' });
    return res.status(200).json({ success: true, message: 'Document verified' });
  } catch (error) {
    console.error('❌ [AdminWarexPedia] verifyDocument error:', error.message);
    return res.status(500).json({ message: 'Failed to verify document' });
  }
};

const rejectDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE warexpedia_documents SET verification_status = 'rejected' WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Document not found' });
    return res.status(200).json({ success: true, message: 'Document rejected' });
  } catch (error) {
    console.error('❌ [AdminWarexPedia] rejectDocument error:', error.message);
    return res.status(500).json({ message: 'Failed to reject document' });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM warexpedia_documents WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Document not found' });
    return res.status(200).json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('❌ [AdminWarexPedia] deleteDocument error:', error.message);
    return res.status(500).json({ message: 'Failed to delete document' });
  }
};

module.exports = {
  getAllAdminDocuments,
  verifyDocument,
  rejectDocument,
  deleteDocument
};
