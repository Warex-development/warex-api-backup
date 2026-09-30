const pool = require('../config/database');
const { sendNotifyMeAlert } = require('../services/emailService');

// Helper to generate unique request ID
const generateUniqueRequestId = async () => {
  let requestId;
  let isUnique = false;
  
  while (!isUnique) {
    const random = Math.floor(1000 + Math.random() * 9000);
    requestId = `REQ-${random}`;
    const result = await pool.query('SELECT id FROM buyer_requests WHERE request_id = $1', [requestId]);
    isUnique = result.rows.length === 0;
  }
  
  return requestId;
};

// --- BUYER CONTROLLERS ---

const createRequest = async (req, res) => {
  try {
    const {
      item_name, description, oem, make, manufacturer,
      condition_preference, quantity, budget_min, budget_max, urgency, category_id, listing_id
    } = req.body;
    
    const buyer_id = req.user.id;
    const request_id = await generateUniqueRequestId();
    
    const result = await pool.query(
      `INSERT INTO buyer_requests (
        request_id, buyer_id, item_name, description, oem, make, manufacturer,
        condition_preference, quantity, budget_min, budget_max, urgency, category_id, listing_id, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        request_id, buyer_id, item_name, description, oem, make, manufacturer,
        condition_preference, quantity || 1, budget_min, budget_max, urgency || 'Normal', category_id, listing_id || null, 'pending'
      ]
    );
    
    console.log(`📝 [REQUEST] New request created: ${request_id} by ${req.user.email}`);

    if (req.body.isNotifyMe && listing_id) {
      try {
        const listingResult = await pool.query('SELECT * FROM listings WHERE id = $1', [listing_id]);
        if (listingResult.rows.length > 0) {
          const listing = listingResult.rows[0];
          const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [listing.seller_id]);
          const seller = sellerResult.rows[0] || {};
          
          await sendNotifyMeAlert({
            name: req.user.full_name || req.user.first_name,
            email: req.user.email,
            phone: req.user.mobile || req.user.phone,
            company: req.user.company_name,
            quantity: quantity || 1
          }, listing, seller);
        }
      } catch (err) {
        console.error('❌ [REQUEST] Failed to send NotifyMe alert:', err.message);
      }
    }
    
    return res.status(201).json({
      message: 'Request created successfully',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [REQUEST] Create error:', error.message);
    return res.status(500).json({ message: 'Failed to create request' });
  }
};

/**
 * POST /api/requests/bulk
 * Creates multiple buyer requests atomically from a cart submission
 */
const createBulkRequests = async (req, res) => {
  const client = await pool.connect();
  try {
    const { items, urgency = 'Normal', description = '' } = req.body;
    const buyer_id = req.user.id;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Cart items array is required' });
    }

    await client.query('BEGIN');

    const createdRequests = [];
    const randomBatch = Math.floor(1000 + Math.random() * 9000);
    const batchRef = `BATCH-${randomBatch}`;

    for (const item of items) {
      const requestId = await generateUniqueRequestId();
      const qty = parseFloat(item.quantity || item.requested_quantity) || 1;
      const targetPrice = Math.round(parseFloat(item.target_price ?? item.offered_price ?? item.price_max ?? item.unit_price ?? 0));
      const budgetMin = item.price_min ? Math.round(parseFloat(item.price_min)) : targetPrice;
      const budgetMax = targetPrice > 0 ? targetPrice : (item.price_max ? Math.round(parseFloat(item.price_max)) : budgetMin);
      const itemDesc = description ? `${description} (${batchRef})` : `Multi-item quote request from Cart (${batchRef})`;

      const result = await client.query(
        `INSERT INTO buyer_requests (
          request_id, buyer_id, item_name, description, oem, make, manufacturer,
          condition_preference, quantity, budget_min, budget_max, urgency, category_id, listing_id, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *`,
        [
          requestId, 
          buyer_id, 
          item.name || item.item_name || 'Industrial Part', 
          itemDesc, 
          item.oem || null, 
          item.make || null, 
          item.manufacturer || null,
          item.condition || item.condition_preference || 'Good', 
          qty, 
          budgetMin, 
          budgetMax, 
          urgency, 
          item.category_id || null, 
          item.listing_id || item.id || null, 
          'pending'
        ]
      );

      createdRequests.push(result.rows[0]);
    }

    await client.query('COMMIT');

    console.log(`📦 [BULK RFQ] Created ${createdRequests.length} requests in batch ${batchRef} for ${req.user.email}`);

    return res.status(201).json({
      success: true,
      message: `Successfully created ${createdRequests.length} quote requests`,
      batch_id: batchRef,
      batch_ref: batchRef,
      count: createdRequests.length,
      created_count: createdRequests.length,
      requests: createdRequests
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [BULK RFQ] Error creating batch requests:', error.message);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({ message: isProd ? 'Failed to create bulk requests. Please try again.' : 'Failed to create bulk requests: ' + error.message });
  } finally {
    client.release();
  }
};

/**
 * Helper: Groups multi-item cart requests by batch_id so that batch orders appear as 1 clean RFQ row
 */
function groupRequestsByBatch(rows) {
  const result = [];
  const batchMap = new Map();

  for (const row of rows) {
    if (row.batch_id) {
      if (!batchMap.has(row.batch_id)) {
        const batchItem = {
          ...row,
          id: row.batch_id,
          request_id: row.batch_id,
          is_batch: true,
          batch_ref: row.batch_id,
          item_name: `Multi-Item RFQ (${row.batch_id})`,
          items: [],
          quantity: 0,
          budget_min: 0,
          budget_max: 0,
          budget: 0
        };
        batchMap.set(row.batch_id, batchItem);
        result.push(batchItem);
      }
      const b = batchMap.get(row.batch_id);
      b.items.push(row);
      if (row.linked_deal_stage && !b.linked_deal_stage) {
        b.linked_deal_stage = row.linked_deal_stage;
        b.deal_id_uuid = row.deal_id_uuid;
        b.deal_ref_no = row.deal_ref_no;
        b.deal_final_price = row.deal_final_price;
        b.deal_proforma_url = row.deal_proforma_url;
      }
      const rowQty = parseInt(row.quantity) || 1;
      b.quantity += rowQty;
      const rowBudget = parseFloat(row.budget_max || row.budget || row.budget_min || 0);
      b.budget_max += rowBudget * rowQty;
      b.budget_min += (parseFloat(row.budget_min) || rowBudget) * rowQty;
      b.budget += rowBudget * rowQty;
    } else {
      result.push(row);
    }
  }

  // Polish batch descriptions and names
  for (const b of batchMap.values()) {
    const summary = b.items.map(i => `${i.item_name} (x${i.quantity || 1})`).join(', ');
    b.item_name = `Multi-Item Order (${b.items.length} Items)`;
    b.batch_item_names = summary;
    b.description = `Cart Order (${b.items.length} items): ${summary}`;
  }

  return result;
}

const getMyRequests = async (req, res) => {
  try {
    const { search } = req.query;
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    let baseQuery = "FROM buyer_requests r LEFT JOIN deals d ON (r.id = d.buyer_request_id OR (r.batch_id IS NOT NULL AND d.proforma_data->>'batch_id' = r.batch_id)) AND d.stage != 'cancelled'";
    let whereClause = 'WHERE 1=1';
    let params = [];
    
    whereClause += ' AND r.buyer_id = $1';
    params.push(req.user.id);

    if (search) {
      const searchTerm = `%${search}%`;
      whereClause += ` AND (r.request_id ILIKE $${params.length + 1} OR r.item_name ILIKE $${params.length + 1} OR r.description ILIKE $${params.length + 1} OR r.batch_id ILIKE $${params.length + 1})`;
      params.push(searchTerm);
    }

    const dataResult = await pool.query(
      `SELECT r.*, 
              d.id as deal_id_uuid,
              d.deal_id as deal_ref_no,
              d.stage as linked_deal_stage,
              d.final_price as deal_final_price,
              d.base_amount as deal_base_amount,
              d.wallet_discount as deal_wallet_discount,
              d.special_discount as deal_special_discount,
              d.proforma_url as deal_proforma_url,
              d.proforma_date as deal_proforma_date,
              d.quantity as deal_quantity
       ${baseQuery}
       ${whereClause}
       ORDER BY r.created_at DESC`,
      params
    );

    const groupedData = groupRequestsByBatch(dataResult.rows);

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      const paginatedData = groupedData.slice(offset, offset + safeLimit);
      const total = groupedData.length;
      const totalPages = Math.ceil(total / safeLimit) || 1;

      return res.status(200).json({
        data: paginatedData,
        page,
        limit: safeLimit,
        total,
        totalPages
      });
    } else {
      return res.status(200).json(groupedData);
    }
  } catch (error) {
    console.error('❌ [REQUEST] Get my requests error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve your requests' });
  }
};

const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const buyer_id = req.user.id;
    
    const checkResult = await pool.query(
      'SELECT status, buyer_id, batch_id FROM buyer_requests WHERE id = $1 OR batch_id = $1',
      [id]
    );
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }
    
    const request = checkResult.rows[0];
    
    if (request.buyer_id !== buyer_id) {
      return res.status(403).json({ message: 'Not authorized to delete this request' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Cannot delete request that is not in pending status' });
    }
    
    await pool.query('DELETE FROM buyer_requests WHERE id = $1 OR batch_id = $1', [id]);
    
    return res.status(200).json({ message: 'Request deleted successfully' });
  } catch (error) {
    console.error('❌ [REQUEST] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete request' });
  }
};

// --- ADMIN CONTROLLERS ---

const adminGetAllRequests = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { status, search } = req.query;
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    let baseQuery = "FROM buyer_requests r LEFT JOIN users u ON r.buyer_id = u.id LEFT JOIN listings l ON r.listing_id = l.id LEFT JOIN users su ON l.seller_id = su.id LEFT JOIN deals d ON (r.id = d.buyer_request_id OR (r.batch_id IS NOT NULL AND d.proforma_data->>'batch_id' = r.batch_id)) AND d.stage != 'cancelled'";
    let whereClause = '';
    let params = [];
    
    if (status) {
      whereClause = ' WHERE r.status = $1';
      params.push(status);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + `(r.request_id ILIKE $${params.length + 1} OR r.item_name ILIKE $${params.length + 1} OR r.description ILIKE $${params.length + 1} OR r.batch_id ILIKE $${params.length + 1} OR l.name ILIKE $${params.length + 1} OR u.company_name ILIKE $${params.length + 1})`;
      params.push(searchTerm);
    }
    
    const dataQuery = `
      SELECT r.*, u.code as buyer_code, u.full_name as buyer_name, u.company_name as buyer_company, u.vat_number as buyer_vat,
             u.email as buyer_email, u.mobile as buyer_phone, u.mobile as buyer_mobile, u.address as buyer_address,
             l.seller_id, l.name as listing_name, l.images as listing_images, l.quantity as listing_quantity, l.quantity_unit as listing_quantity_unit, COALESCE(l.seller_bid_price, l.bid_price, 0) as listing_bid_price, l.status as listing_status, l.is_hidden as listing_is_hidden,
             su.company_name as seller_company, su.vat_number as seller_vat, su.full_name as seller_name,
             d.stage as linked_deal_stage
      ${baseQuery}
      ${whereClause}
      ORDER BY r.created_at DESC
    `;
    const dataResult = await pool.query(dataQuery, params);
    const groupedData = groupRequestsByBatch(dataResult.rows);

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      const paginatedData = groupedData.slice(offset, offset + safeLimit);
      const total = groupedData.length;
      const totalPages = Math.ceil(total / safeLimit) || 1;

      return res.status(200).json({
        data: paginatedData,
        page,
        limit: safeLimit,
        total,
        totalPages
      });
    } else {
      return res.status(200).json(groupedData);
    }
  } catch (error) {
    console.error('❌ [ADMIN REQUEST] Get all error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve requests' });
  }
};

const adminGetRequestById = async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    
    const query = `
      SELECT r.*, 
             u.code as buyer_code, u.full_name as buyer_name, u.company_name as buyer_company, 
             u.vat_number as buyer_vat, u.email as buyer_email, u.mobile as buyer_phone, u.mobile as buyer_mobile, u.address as buyer_address,
             l.seller_id, l.name as listing_name, l.images as listing_images, l.quantity as listing_quantity, 
             l.quantity_unit as listing_quantity_unit, COALESCE(l.seller_bid_price, l.bid_price, 0) as listing_bid_price, l.status as listing_status, 
             l.make as listing_brand, l.oem as listing_oem, l.manufacturer as listing_manufacturer, l.condition as listing_condition,
             su.company_name as seller_company, su.vat_number as seller_vat, su.full_name as seller_name,
             su.email as seller_email, su.mobile as seller_phone,
             d.id as deal_id_uuid, d.deal_id as deal_ref_no, d.stage as linked_deal_stage,
             d.final_price as deal_final_price, d.proforma_url as deal_proforma_url
      FROM buyer_requests r 
      LEFT JOIN users u ON r.buyer_id = u.id 
      LEFT JOIN listings l ON r.listing_id = l.id 
      LEFT JOIN users su ON l.seller_id = su.id 
      LEFT JOIN deals d ON (r.id = d.buyer_request_id OR (r.batch_id IS NOT NULL AND d.proforma_data->>'batch_id' = r.batch_id)) AND d.stage != 'cancelled'
      WHERE r.id::text = $1 OR r.request_id = $1 OR r.batch_id = $1
      ORDER BY r.created_at ASC
    `;
    
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Buyer request not found' });
    }

    if (result.rows.length > 1 || result.rows[0].batch_id) {
      const grouped = groupRequestsByBatch(result.rows);
      return res.status(200).json(grouped[0]);
    }
    
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('❌ [ADMIN REQUEST] Get by ID error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve request details' });
  }
};

const adminUpdateStatus = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    const { status } = req.body;
    
    if (status === 'cancelled' || status === 'archived') {
      const dealCheck = await pool.query('SELECT id FROM deals WHERE buyer_request_id = $1', [id]);
      if (dealCheck.rows.length > 0) {
        return res.status(400).json({ message: `Cannot change status to ${status} because this request is linked to a deal` });
      }
    }
    
    const result = await pool.query(
      'UPDATE buyer_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }
    
    return res.status(200).json({
      message: 'Request status updated',
      request: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [ADMIN REQUEST] Update status error:', error.message);
    return res.status(500).json({ message: 'Failed to update request status' });
  }
};

const adminDeleteRequest = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    
    const checkResult = await pool.query('SELECT id, batch_id FROM buyer_requests WHERE id::text = $1 OR batch_id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }
    
    const bId = checkResult.rows[0].batch_id;
    const dealCheck = await pool.query(
      `SELECT id FROM deals 
       WHERE buyer_request_id::text = $1 
          OR proforma_data->>'batch_id' = $1 
          OR ($2 <> '' AND proforma_data->>'batch_id' = $2)`, 
      [id, bId || '']
    );
    if (dealCheck.rows.length > 0) {
      return res.status(400).json({ message: 'Cannot delete request that is linked to a deal' });
    }
    
    await pool.query('DELETE FROM buyer_requests WHERE id::text = $1 OR batch_id = $1', [id]);
    
    return res.status(200).json({ message: 'Request deleted successfully' });
  } catch (error) {
    console.error('❌ [ADMIN REQUEST] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete request' });
  }
};

module.exports = {
  createRequest,
  createBulkRequests,
  getMyRequests,
  deleteRequest,
  adminGetAllRequests,
  adminGetRequestById,
  adminUpdateStatus,
  adminDeleteRequest
};
