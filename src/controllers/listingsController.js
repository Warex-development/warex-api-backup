const pool = require('../config/database');
const { createNotification } = require('../services/notificationService');
const { sendNewListingAlert, sendListingApprovedEmail, sendListingCorrectionEmail } = require('../services/emailService');
const { creditListingApproval, reverseListingCredit, recreditListingUnhide } = require('../services/walletService');
const XLSX = require('xlsx');

// Helper to generate unique request ID
const generateUniqueRequestId = async () => {
  let requestId;
  let isUnique = false;

  while (!isUnique) {
    const random = Math.floor(1000 + Math.random() * 9000);
    requestId = `REQ-${random}`;
    const result = await pool.query('SELECT id FROM listings WHERE request_id = $1', [requestId]);
    isUnique = result.rows.length === 0;
  }

  return requestId;
};

// --- SELLER CONTROLLERS ---

const bulkUploadListings = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const client = await pool.connect();
  try {
    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ message: 'Excel file is empty' });
    }

    const seller_id = req.user.id;
    const inserted = [];
    const failedRows = [];

    // --- PLAN LIMIT CHECK ---
    const userResult = await client.query('SELECT plan FROM users WHERE id = $1', [seller_id]);
    const userPlan = (userResult.rows[0]?.plan || 'Free').toLowerCase();
    
    const planLimits = {
      'free': 50,
      'professional': 500,
      'enterprise': 999999
    };
    const limit = planLimits[userPlan] || 50;

    const countResult = await client.query(
      "SELECT COUNT(*) FROM listings WHERE seller_id = $1 AND status != 'rejected' AND status != 'deleted'",
      [seller_id]
    );
    const currentCount = parseInt(countResult.rows[0].count);

    if (currentCount >= limit) {
      return res.status(403).json({ 
        message: `Listing limit reached for ${userPlan} plan (${limit}). Please upgrade to add more items.` 
      });
    }

    // Also check if bulk upload will exceed limit
    if (currentCount + rows.length > limit) {
       return res.status(403).json({ 
        message: `This upload of ${rows.length} items will exceed your ${userPlan} plan limit of ${limit}. Current listings: ${currentCount}. Remaining: ${limit - currentCount}.`
      });
    }

    await client.query('BEGIN');

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex];
      const rowNum = rowIndex + 2; // Excel row number (1=header, 2=first data)

      // Column mapping — Support new template columns exactly as they appear
      const item_name = row['Item description/Specs'] || row['Item Name'] || row['ITEM NAME'] || row['ITEM DESCRIPTION SPEC'];
      const description = row['Item description/Specs'] || row['ITEM DESCRIPTION SPEC'] || row['Description'] || '';
      const make = row['Make/Brand'] || row['MAKE'] || row['Make'] || '';
      const oem = row['Part Number(OEM/Make/brand)'] || row['OEM/ Brand part number'] || row['OEM PART NO'] || row['OEM'] || '';

      // condition normalize karo
      const conditionMap = {
        'brand new': 'Brand New/Unused',
        'brand new/unused': 'Brand New/Unused',
        'used': 'Used but in Good Condition',
        'good': 'Used but in Good Condition',
        'used but in good condition': 'Used but in Good Condition',
        'damaged': 'Damaged/Scrap',
        'scrap': 'Damaged/Scrap',
        'damaged/scrap': 'Damaged/Scrap',
      };
      const rawCondition = (row['Condition'] || row['CONDITION'] || '').toString().trim().toLowerCase();
      const condition = conditionMap[rawCondition] || row['Condition'] || row['CONDITION'] || '';

      const year = parseInt(row['YEAR OF PURCHASE'] || row['Year'] || 0) || null;
      
      // Handle price column (case insensitive and handle commas/currency)
      const rawPrice = row['price'] || row['Price'] || row['BID PRICE'] || '0';
      const cleanPrice = rawPrice.toString().replace(/[^0-9.]/g, '');
      const bid_price = parseFloat(cleanPrice);

      const remarks = row['REMARKS'] || row['Remarks'] || '';
      const image_url = row['PICTURE'] || row['image_url'] || '';

      // Row level validation
      const rowErrors = [];

      if (!item_name || item_name.toString().trim() === '') {
        rowErrors.push('Item description/Specs is mandatory');
      }
      if (!condition || condition.toString().trim() === '') {
        rowErrors.push('Condition is mandatory (e.g., Brand New, Used, etc.)');
      }
      if (!bid_price || isNaN(bid_price) || bid_price <= 0) {
        rowErrors.push('Price is mandatory and must be a valid number > 0');
      }

      // Agar errors hain → skip row, collect error
      if (rowErrors.length > 0) {
        failedRows.push({
          row: rowNum,
          item: item_name || 'Unknown',
          errors: rowErrors
        });
        continue; // Skip this row, continue with next
      }

      // Valid row → insert karo
      const request_id = await generateUniqueRequestId();

      // Duplicate check for bulk
      const dupCheck = await client.query(
        "SELECT id, status FROM listings WHERE seller_id = $1 AND (LOWER(name) = LOWER($2) OR (oem IS NOT NULL AND oem != '' AND LOWER(oem) = LOWER($3))) LIMIT 1",
        [seller_id, item_name.toString().trim(), oem || '']
      );

      let is_duplicate = false;
      if (dupCheck.rows.length > 0) {
        is_duplicate = true;
      }

      const quantity = parseInt(row['Quantity'] || row['QUANTITY'] || row['Qty'] || row['QTY'] || 1) || 1;

      const result = await client.query(
        `INSERT INTO listings (
          request_id, name, description, oem, make,
          condition, year, seller_bid_price, images, status,
          seller_id, quantity, is_hidden, is_duplicate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13)
        RETURNING *`,
        [
          request_id, item_name.toString().trim(), description, oem, make,
          condition, year, bid_price, image_url ? [image_url] : [], 'pending',
          seller_id, quantity, is_duplicate
        ]
      );
      inserted.push(result.rows[0]);
    }

    await client.query('COMMIT');
    console.log(`📊 [BULK] ${inserted.length} listings uploaded by ${req.user.email}`);

    // Notify Admins
    if (inserted.length > 0) {
      const { notifyAdmins } = require('../services/notificationService');
      await notifyAdmins(
        'Bulk Listing Upload 📦',
        `${req.user.email} uploaded ${inserted.length} new listings for review.`,
        'listing',
        '/admin/pending-queue'
      );
    }

    // Response mein success + failed dono batao
    return res.status(201).json({
      message: `${inserted.length} listings uploaded successfully`,
      count: inserted.length,
      success: inserted,
      failed: failedRows,  // ← Failed rows with reasons
      total_rows: rows.length
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [BULK] Upload error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to process bulk upload' });
  } finally {
    client.release();
  }
};

const createListing = async (req, res) => {
  try {
    const {
      name, description, oem, make, manufacturer,
      condition, year, eta, availability, application,
      seller_bid_price, category_id, remarks, quantity, quantity_unit, warranty_months, custom_category
    } = req.body;

    const applicationArray = Array.isArray(application)
      ? application
      : (application ? [application] : []);

    const seller_id = req.user.id;

    // --- PLAN LIMIT CHECK ---
    const userResult = await pool.query('SELECT plan FROM users WHERE id = $1', [seller_id]);
    const userPlan = (userResult.rows[0]?.plan || 'Free').toLowerCase();
    
    // Define limits (keep in sync with frontend constants.js)
    const planLimits = {
      'free': 50,
      'professional': 500,
      'enterprise': 999999
    };
    const limit = planLimits[userPlan] || 50;

    const countResult = await pool.query(
      "SELECT COUNT(*) FROM listings WHERE seller_id = $1 AND status != 'rejected' AND status != 'deleted'",
      [seller_id]
    );
    const currentCount = parseInt(countResult.rows[0].count);

    if (currentCount >= limit) {
      return res.status(403).json({ 
        message: `Listing limit reached for ${userPlan} plan (${limit}). Please upgrade your membership to add more items.`,
        limit_reached: true 
      });
    }

    // --- Validation ---
    if (!name || !condition || !seller_bid_price) {
      return res.status(400).json({ message: 'item_name, condition, and bid_price are required' });
    }
    if (parseFloat(seller_bid_price) <= 0) {
      return res.status(400).json({ message: 'bid_price must be greater than 0' });
    }

    const listingYear = parseInt(year) || null;

    // --- DUPLICATE CHECK ---
    // Detect if same seller already has this item pending or approved
    // Match on OEM part number (exact) OR item name (case-insensitive) to catch both cases
    const dupQuery = `
      SELECT request_id, name, oem, status
      FROM listings
      WHERE seller_id = $1
        AND status IN ('pending', 'pending_review', 'approved')
        AND (
          (oem IS NOT NULL AND oem != '' AND LOWER(oem) = LOWER($2))
          OR
          (LOWER(name) = LOWER($3))
        )
      LIMIT 1
    `;
    const dupResult = await pool.query(dupQuery, [
      seller_id,
      oem || '',
      name
    ]);

    let is_duplicate = false;
    if (dupResult.rows.length > 0) {
      is_duplicate = true;
    }

    const request_id = await generateUniqueRequestId();
    const parsedQuantity = parseFloat(quantity) || 1;
    const parsedWarranty = parseInt(warranty_months) || 0;

    const result = await pool.query(
      `INSERT INTO listings (
        request_id, name, description, oem, make, manufacturer,
        condition, year, eta, availability, application,
        seller_bid_price, category_id, seller_id, status,
        item_name, oem_part_no, year_of_purchase, bid_price, remarks,
        quantity, quantity_unit, is_hidden, is_duplicate, warranty_months, custom_category
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, false, $23, $24, $25)
      RETURNING *`,
      [
        request_id, name, description || null, oem || null, make || null, manufacturer || null,
        condition, listingYear, eta || '3–5 Days', availability || 'In Stock', applicationArray || [],
        seller_bid_price, category_id || null, seller_id, 'pending',
        name, oem || null, listingYear, seller_bid_price, remarks || null,
        parsedQuantity, quantity_unit || 'PCs', is_duplicate, parsedWarranty, custom_category || null
      ]
    );

    console.log(`📦 [LISTING] New manual listing created: ${request_id} by ${req.user.email}`);

    // Notify Admins
    const { notifyAdmins } = require('../services/notificationService');
    await notifyAdmins(
      'New Listing for Review 📦',
      `Seller ${req.user.email} created a new listing: ${name}.`,
      'listing',
      '/admin/pending-queue'
    );

    // Email Alert
    const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [seller_id]);
    await sendNewListingAlert(sellerResult.rows[0], result.rows[0]);

    return res.status(201).json({
      message: 'Listing created and pending admin review',
      listing: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [LISTING] Create error:', error.message);
    return res.status(500).json({ message: 'Failed to create listing' });
  }
};

const getMyListings = async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const search = req.query.search ? req.query.search.trim() : null;
    const filter = req.query.filter ? req.query.filter : 'all';

    let baseQuery = 'FROM listings l LEFT JOIN categories c ON l.category_id = c.id WHERE 1=1';
    let params = [];
    let pIdx = 1;

    baseQuery += ` AND l.seller_id = $1`;
    params.push(req.user.id);
    pIdx = 2;

    if (search) {
      baseQuery += ` AND (l.name ILIKE $${pIdx} OR l.oem ILIKE $${pIdx} OR l.request_id ILIKE $${pIdx} OR array_to_string(l.application, ', ') ILIKE $${pIdx} OR c.name ILIKE $${pIdx})`;
      params.push(`%${search}%`);
      pIdx++;
    }

    if (filter === 'public') {
      baseQuery += ` AND l.is_hidden = false`;
    } else if (filter === 'hidden') {
      baseQuery += ` AND l.is_hidden = true`;
    }

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;

      const dataQuery = `SELECT l.id, l.request_id, l.name, l.description, l.oem, l.make, l.manufacturer, 
                l.condition, l.year, l.eta, l.availability, l.application, l.images, l.document_url, l.category_id,
                l.seller_bid_price, l.pricing_status, l.status, l.created_at, l.is_hidden, l.rejection_reason, l.quantity, l.quantity_unit, c.name as category_name 
         ${baseQuery} 
         ORDER BY l.created_at DESC 
         LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
      
      const dataResult = await pool.query(dataQuery, [...params, safeLimit, offset]);

      const countResult = await pool.query(`SELECT COUNT(*) ${baseQuery}`, params);

      let statsQuery = `SELECT 
          COUNT(*) FILTER (WHERE status = 'approved') as all_approved,
          COUNT(*) FILTER (WHERE status = 'approved' AND is_hidden = false) as public_approved,
          COUNT(*) FILTER (WHERE status = 'approved' AND is_hidden = true) as hidden_approved,
          COUNT(*) FILTER (WHERE status ILIKE '%pending%') as pending_count
         FROM listings WHERE 1=1`;
      let statsParams = [];
      if (req.user.role !== 'sales') {
        statsQuery += ` AND seller_id = $1`;
        statsParams.push(req.user.id);
      }
      
      const statsResult = await pool.query(statsQuery, statsParams);

      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      const stats = {
        allApproved: parseInt(statsResult.rows[0].all_approved || 0),
        public: parseInt(statsResult.rows[0].public_approved || 0),
        hidden: parseInt(statsResult.rows[0].hidden_approved || 0),
        pending: parseInt(statsResult.rows[0].pending_count || 0)
      };

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages,
        counts: stats
      });
    } else {
      const dataQuery = `SELECT l.id, l.request_id, l.name, l.description, l.oem, l.make, l.manufacturer, 
                l.condition, l.year, l.eta, l.availability, l.application, l.images, l.document_url, l.category_id,
                l.seller_bid_price, l.pricing_status, l.status, l.created_at, l.is_hidden, l.rejection_reason, l.quantity, l.quantity_unit, c.name as category_name 
         ${baseQuery} 
         ORDER BY l.created_at DESC`;
      const result = await pool.query(dataQuery, params);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [LISTING] Get my listings error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve your listings' });
  }
};

const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const seller_id = req.user.id;

    const checkResult = await pool.query(
      'SELECT status, seller_id, update_status FROM listings WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = checkResult.rows[0];

    if (listing.seller_id !== seller_id) {
      return res.status(403).json({ message: 'Not authorized to edit this listing' });
    }

    // Block direct edits if a pending update already exists
    if (listing.update_status === 'pending') {
      return res.status(400).json({
        message: 'You already have a pending update awaiting admin approval. Please wait for it to be reviewed.',
        update_status: 'pending'
      });
    }

    const {
      name, description, oem, make, manufacturer,
      condition, year, eta, availability, application,
      seller_bid_price, category_id, images, document_url, warranty_months, status, quantity, quantity_unit, custom_category
    } = req.body;

    // If listing is APPROVED → Maker-Checker: save to pending_updates, don't overwrite
    if (listing.status === 'approved') {
      const pendingUpdates = {
        name, description, oem, make, manufacturer,
        condition, year, eta, availability, application,
        seller_bid_price, category_id, images, document_url, warranty_months, quantity, quantity_unit, custom_category,
        requested_at: new Date().toISOString()
      };
      // Remove undefined fields
      Object.keys(pendingUpdates).forEach(k => {
        if (pendingUpdates[k] === undefined) delete pendingUpdates[k];
      });

      const result = await pool.query(
        `UPDATE listings SET 
          pending_updates = $1::jsonb, 
          update_status = 'pending',
          updated_at = NOW()
        WHERE id = $2 AND seller_id = $3 RETURNING id, update_status, pending_updates`,
        [JSON.stringify(pendingUpdates), id, seller_id]
      );

      return res.status(200).json({
        message: 'Update request submitted for admin approval. Your listing will be updated once approved.',
        listing: result.rows[0],
        update_status: 'pending'
      });
    }

    // Non-approved listings (pending / correction_needed) can be edited directly
    if (!['pending', 'correction_needed'].includes(listing.status)) {
      return res.status(400).json({ message: 'Cannot edit listing in its current status' });
    }

    const category_id_clean = (category_id === '') ? null : category_id;
    const year_clean = (year === '') ? null : year;
    const warranty_months_clean = (warranty_months === '') ? null : warranty_months;
    const application_clean = Array.isArray(application) ? application : (application ? [application] : []);
    const quantity_clean = (quantity !== undefined && quantity !== null) ? parseFloat(quantity) : listing.quantity;
    const auto_hide = (quantity_clean <= 0); // auto-hide if quantity is 0

    const result = await pool.query(
      `UPDATE listings SET
        name = COALESCE($1, name), 
        description = COALESCE($2, description), 
        oem = COALESCE($3, oem), 
        make = COALESCE($4, make), 
        manufacturer = COALESCE($5, manufacturer),
        condition = COALESCE($6, condition), 
        year = COALESCE($7, year), 
        eta = COALESCE($8, eta), 
        availability = COALESCE($9, availability), 
        application = COALESCE($10, application),
        seller_bid_price = COALESCE($11, seller_bid_price), 
        category_id = COALESCE($12, category_id), 
        images = COALESCE($13, images),
        document_url = COALESCE($14, document_url),
        warranty_months = COALESCE($15, warranty_months),
        status = COALESCE($16, status),
        quantity = COALESCE($17, quantity),
        quantity_unit = COALESCE($18, quantity_unit),
        custom_category = COALESCE($19, custom_category),
        is_hidden = CASE WHEN $17 <= 0 THEN true ELSE is_hidden END,
        updated_at = NOW()
      WHERE id = $20 AND seller_id = $21 RETURNING *`,
      [
        name, description, oem, make, manufacturer,
        condition, year_clean, eta, availability, application_clean,
        seller_bid_price, category_id_clean, images, document_url,
        warranty_months_clean, status || listing.status, quantity_clean, quantity_unit || listing.quantity_unit, custom_category, id, seller_id
      ]
    );

    return res.status(200).json({
      message: 'Listing updated successfully',
      listing: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [LISTING] Update error:', error.message);
    return res.status(500).json({ message: 'Failed to update listing' });
  }
};

const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const seller_id = req.user.id;

    const checkResult = await pool.query(
      'SELECT status, seller_id FROM listings WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = checkResult.rows[0];

    if (listing.seller_id !== seller_id) {
      return res.status(403).json({ message: 'Not authorized to delete this listing' });
    }

    if (!['pending', 'correction_needed'].includes(listing.status)) {
      return res.status(400).json({ message: 'Cannot delete listing after it has been processed' });
    }

    await pool.query('DELETE FROM listings WHERE id = $1', [id]);

    return res.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    console.error('❌ [LISTING] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete listing' });
  }
};

// --- BUYER CONTROLLERS ---

const getListings = async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const { search, brands, brandOther, oem, conditions, applications, applicationOther, minPrice, maxPrice, age } = req.query;

    let whereClause = "l.status = 'approved' AND l.is_hidden = false AND l.seller_id IN (SELECT id FROM users WHERE status = 'active')";
    const params = [];
    let pIdx = 1;

    if (search) {
      whereClause += ` AND (l.name ILIKE $${pIdx} OR l.oem ILIKE $${pIdx} OR l.make ILIKE $${pIdx} OR l.manufacturer ILIKE $${pIdx} OR c.name ILIKE $${pIdx} OR array_to_string(l.application, ', ') ILIKE $${pIdx})`;
      params.push(`%${search}%`);
      pIdx++;
    }

    if (brands) {
      const brandList = brands.split(',').filter(b => b !== 'Others').map(b => b.toLowerCase());
      const hasOthers = brands.split(',').includes('Others');
      let brandConds = [];
      if (brandList.length > 0) {
        brandConds.push(`LOWER(COALESCE(l.make, l.manufacturer, '')) = ANY($${pIdx})`);
        params.push(brandList);
        pIdx++;
      }
      if (hasOthers && brandOther) {
        brandConds.push(`(l.make ILIKE $${pIdx} OR l.manufacturer ILIKE $${pIdx})`);
        params.push(`%${brandOther}%`);
        pIdx++;
      }
      if (brandConds.length > 0) {
        whereClause += ` AND (${brandConds.join(' OR ')})`;
      }
    }

    if (oem) {
      whereClause += ` AND l.oem ILIKE $${pIdx}`;
      params.push(`%${oem}%`);
      pIdx++;
    }

    if (conditions) {
      const condList = conditions.split(',');
      whereClause += ` AND l.condition = ANY($${pIdx})`;
      params.push(condList);
      pIdx++;
    }

    if (applications) {
      const appList = applications.split(',').filter(a => a !== 'Others');
      const hasOthers = applications.split(',').includes('Others');
      let appConds = [];
      if (appList.length > 0) {
        appConds.push(`l.application && $${pIdx}`); // Postgres Array overlap
        params.push(appList);
        pIdx++;
      }
      if (hasOthers && applicationOther) {
        appConds.push(`EXISTS (SELECT 1 FROM unnest(l.application) a WHERE a ILIKE $${pIdx})`);
        params.push(`%${applicationOther}%`);
        pIdx++;
      }
      if (appConds.length > 0) {
        whereClause += ` AND (${appConds.join(' OR ')})`;
      }
    }

    if (minPrice) {
      whereClause += ` AND l.buyer_visible_min >= $${pIdx}`;
      params.push(parseFloat(minPrice));
      pIdx++;
    }

    if (maxPrice && parseFloat(maxPrice) < 5000000) {
      whereClause += ` AND l.buyer_visible_min <= $${pIdx}`;
      params.push(parseFloat(maxPrice));
      pIdx++;
    }

    if (age) {
      if (age === 'today') {
        whereClause += ` AND l.created_at >= NOW() - INTERVAL '1 day'`;
      } else if (age === '7days') {
        whereClause += ` AND l.created_at >= NOW() - INTERVAL '7 days'`;
      } else if (age === '30days') {
        whereClause += ` AND l.created_at >= NOW() - INTERVAL '30 days'`;
      } else if (age === 'thisyear') {
        whereClause += ` AND l.created_at >= date_trunc('year', NOW())`;
      }
    }

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;

      const dataResult = await pool.query(`
        SELECT 
          l.id, l.request_id, l.name, l.description, l.category_id,
          l.condition, l.oem, l.make, l.manufacturer, l.year, l.eta, l.availability,
          l.application, l.images, l.document_url, l.buyer_visible_min, l.buyer_visible_max, l.created_at,
          l.warranty_months, l.approved_on, l.quantity, l.quantity_unit
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC
        LIMIT $${pIdx} OFFSET $${pIdx + 1}
      `, [...params, safeLimit, offset]);

      const countResult = await pool.query(`SELECT COUNT(*) FROM listings l LEFT JOIN categories c ON l.category_id = c.id WHERE ${whereClause}`, params);
      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages
      });
    } else {
      const result = await pool.query(`
        SELECT 
          l.id, l.request_id, l.name, l.description, l.category_id,
          l.condition, l.oem, l.make, l.manufacturer, l.year, l.eta, l.availability,
          l.application, l.images, l.document_url, l.buyer_visible_min, l.buyer_visible_max, l.created_at,
          l.warranty_months, l.approved_on, l.quantity, l.quantity_unit
        FROM listings l
        LEFT JOIN categories c ON l.category_id = c.id
        WHERE ${whereClause}
        ORDER BY l.created_at DESC
      `, params);

      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [LISTING] Get listings error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve listings' });
  }
};

// --- ADMIN CONTROLLERS ---

const adminGetAllListings = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { status, seller_id, search } = req.query;
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    let baseQuery = 'FROM listings l LEFT JOIN users u ON l.seller_id = u.id LEFT JOIN categories c ON l.category_id = c.id';
    let whereClause = '';
    let params = [];

    if (status) {
      whereClause = ' WHERE l.status = $1';
      params.push(status);
    }

    if (seller_id) {
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + `l.seller_id = $${params.length + 1}`;
      params.push(seller_id);
    }

    if (search) {
      const searchTerm = `%${search}%`;
      whereClause += (whereClause ? ' AND ' : ' WHERE ') + `(l.name ILIKE $${params.length + 1} OR l.oem ILIKE $${params.length + 1} OR l.request_id ILIKE $${params.length + 1} OR l.oem_part_no ILIKE $${params.length + 1} OR c.name ILIKE $${params.length + 1})`;
      params.push(searchTerm);
    }

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;

      const dataQuery = `SELECT l.*, u.full_name AS seller_name, u.company_name AS seller_company, c.name AS category_name ${baseQuery} ${whereClause} ORDER BY l.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      const dataResult = await pool.query(dataQuery, [...params, safeLimit, offset]);

      const countQuery = `SELECT COUNT(*) ${baseQuery} ${whereClause}`;
      const countResult = await pool.query(countQuery, params);

      const total = parseInt(countResult.rows[0].count);
      const totalPages = Math.ceil(total / safeLimit);

      return res.status(200).json({
        data: dataResult.rows,
        page,
        limit: safeLimit,
        total,
        totalPages
      });
    } else {
      // OLD format (array)
      const result = await pool.query(`SELECT l.*, u.full_name AS seller_name, u.company_name AS seller_company, c.name AS category_name ${baseQuery} ${whereClause} ORDER BY l.created_at DESC`, params);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Get all error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve listings' });
  }
};

const adminGetPendingListings = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const result = await pool.query(
      `SELECT l.*, u.full_name AS seller_name, u.email AS seller_email, u.company_name AS seller_company,
        EXISTS (
          SELECT 1 FROM listings d 
          WHERE d.seller_id = l.seller_id 
            AND d.id != l.id 
            AND d.status IN ('pending', 'approved')
            AND (LOWER(d.name) = LOWER(l.name) OR (d.oem IS NOT NULL AND d.oem != '' AND LOWER(d.oem) = LOWER(l.oem)))
        ) as is_duplicate
       FROM listings l
       LEFT JOIN users u ON l.seller_id = u.id
       WHERE l.status = 'pending'
       ORDER BY l.created_at DESC`
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Get pending error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve pending listings' });
  }
};

const adminApproveListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const checkResult = await pool.query('SELECT seller_bid_price FROM listings WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const seller_bid_price = parseFloat(checkResult.rows[0].seller_bid_price);
    const buyer_visible_min = Math.round(seller_bid_price * 0.95);
    const buyer_visible_max = Math.round(seller_bid_price * 1.25);

    const result = await pool.query(
      `UPDATE listings SET
        status = 'approved',
        approved_by = $1,
        approved_on = NOW(),
        approved_at = NOW(),
        buyer_visible_min = $2,
        buyer_visible_max = $3,
        updated_at = NOW()
      WHERE id = $4 AND status = 'pending' RETURNING *`,
      [req.user.id, buyer_visible_min, buyer_visible_max, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found or not in pending status' });
    }
    const approvedListing = result.rows[0];

    // Credit member's wallet NPR 500
    try {
      await creditListingApproval(approvedListing.seller_id, approvedListing.id);
    } catch (walletErr) {
      console.warn('⚠️ [WALLET] Credit on approval failed:', walletErr.message);
    }

    // Send notification to seller
    try {
      await createNotification(
        approvedListing.seller_id,
        "Listing Approved ✅",
        `Your listing ${approvedListing.request_id} has been approved and is now live to buyers. NPR 500 credited to your wallet!`,
        "listing",
        "/dashboard/inventory"
      );
    } catch (notifErr) {
      console.warn('⚠️ [ADMIN LISTING] Notification send failed:', notifErr.message);
    }

    // Email seller (Commented out to save email limits, in-app notification is sent above)
    // const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [approvedListing.seller_id]);
    // await sendListingApprovedEmail(sellerResult.rows[0], approvedListing);

    console.log(`✅ [ADMIN LISTING] Approved: ${approvedListing.request_id} by ${req.user.email}`);
    return res.status(200).json({
      message: 'Listing approved successfully',
      listing: approvedListing
    });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Approve error:', error.message);
    return res.status(500).json({ message: 'Failed to approve listing' });
  }
};

const adminEditListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    
    const checkResult = await pool.query('SELECT * FROM listings WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const {
      name, description, oem, make, manufacturer,
      condition, year, eta, availability, application,
      seller_bid_price, category_id, is_duplicate, images, document_url,
      custom_category, quantity, quantity_unit, warranty_months
    } = req.body;

    const category_id_clean = (category_id === '') ? null : category_id;
    const year_clean = (year === '') ? null : year;
    const application_clean = Array.isArray(application) ? application : (application ? [application] : []);

    const result = await pool.query(
      `UPDATE listings SET
        name = COALESCE($1, name), 
        item_name = COALESCE($1, item_name),
        description = COALESCE($2, description), 
        oem = COALESCE($3, oem), 
        oem_part_no = COALESCE($3, oem_part_no),
        make = COALESCE($4, make), 
        manufacturer = COALESCE($5, manufacturer),
        condition = COALESCE($6, condition), 
        year = COALESCE($7, year), 
        year_of_purchase = COALESCE($7, year_of_purchase),
        eta = COALESCE($8, eta), 
        availability = COALESCE($9, availability), 
        application = COALESCE($10, application),
        seller_bid_price = COALESCE($11, seller_bid_price), 
        bid_price = COALESCE($11, bid_price),
        category_id = COALESCE($12, category_id), 
        is_duplicate = COALESCE($13, is_duplicate),
        images = COALESCE($14, images),
        document_url = COALESCE($15, document_url),
        custom_category = COALESCE($16, custom_category),
        quantity = COALESCE($17, quantity),
        quantity_unit = COALESCE($18, quantity_unit),
        warranty_months = COALESCE($19, warranty_months),
        updated_at = NOW()
      WHERE id = $20 RETURNING *`,
      [
        name, description, oem, make, manufacturer,
        condition, year_clean, eta, availability, application_clean,
        seller_bid_price, category_id_clean, is_duplicate, images, document_url,
        custom_category, quantity, quantity_unit, warranty_months, id
      ]
    );

    console.log(`✅ [ADMIN LISTING] Edited: ${result.rows[0].request_id} by ${req.user.email}`);
    return res.status(200).json({
      message: 'Listing updated successfully',
      listing: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Edit error:', error.message);
    return res.status(500).json({ message: 'Failed to edit listing' });
  }
};

const adminRejectListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({ message: 'rejection_reason is required' });
    }

    const result = await pool.query(
      `UPDATE listings SET
        status = 'rejected',
        rejection_reason = $1,
        updated_at = NOW()
      WHERE id = $2 AND status = 'pending' RETURNING *`,
      [reason.trim(), id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found or not in pending status' });
    }

    const rejectedListing = result.rows[0];

    // Send notification to seller
    try {
      await createNotification(
        rejectedListing.seller_id,
        "Listing Rejected ❌",
        `Your listing ${rejectedListing.request_id} was rejected. Reason: ${reason.trim()}`,
        "listing",
        "/dashboard/inventory"
      );
    } catch (notifErr) {
      console.warn('⚠️ [ADMIN LISTING] Notification send failed:', notifErr.message);
    }

    // Email seller
    const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [rejectedListing.seller_id]);
    await sendListingCorrectionEmail(sellerResult.rows[0], rejectedListing, reason.trim());

    console.log(`❌ [ADMIN LISTING] Rejected: ${rejectedListing.request_id} by ${req.user.email}`);
    return res.status(200).json({
      message: 'Listing rejected',
      listing: rejectedListing
    });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Reject error:', error.message);
    return res.status(500).json({ message: 'Failed to reject listing' });
  }
};

const adminCounterPrice = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const { price } = req.body;

    const result = await pool.query(
      `UPDATE listings SET
        admin_counter_price = $1,
        pricing_status = 'counter_sent',
        updated_at = NOW()
      WHERE id = $2 RETURNING *`,
      [price, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    return res.status(200).json({
      message: 'Counter price sent to seller',
      listing: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Counter price error:', error.message);
    return res.status(500).json({ message: 'Failed to send counter price' });
  }
};

const adminRequestCorrection = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    const { description } = req.body;

    if (!description || !description.trim()) {
      return res.status(400).json({ message: 'Correction description is required' });
    }
    
    const result = await pool.query(
      `UPDATE listings SET
        status = 'correction_needed',
        rejection_reason = $1,
        updated_at = NOW()
      WHERE id = $2 AND status = 'pending' RETURNING *`,
      [description.trim(), id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found or not in pending status' });
    }
    
    const listing = result.rows[0];
    
    try {
      await createNotification(
        listing.seller_id,
        "Correction Needed ⚠️",
        `Admin requested corrections for ${listing.request_id}. Please review and update.`,
        "listing",
        "/dashboard/inventory"
      );
    } catch (notifErr) {
      console.warn('⚠️ [ADMIN LISTING] Notification failed:', notifErr.message);
    }

    // Email seller
    const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [listing.seller_id]);
    await sendListingCorrectionEmail(sellerResult.rows[0], listing, description.trim());

    return res.status(200).json({ message: 'Correction request sent', listing });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Correction error:', error.message);
    return res.status(500).json({ message: 'Failed to request correction' });
  }
};

const hideListing = async (req, res) => {
  try {
    const { id } = req.params;
    const seller_id = req.user.id;

    const result = await pool.query(
      `UPDATE listings SET is_hidden = true, updated_at = NOW()
       WHERE id = $1 AND seller_id = $2 RETURNING *`,
      [id, seller_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found or not owned by you' });
    }

    // Reverse wallet credit (floored at 0)
    try {
      await reverseListingCredit(seller_id, id, 'hidden');
    } catch (wErr) {
      console.warn('⚠️ [WALLET] Reversal on hide failed:', wErr.message);
    }

    console.log(`👁️ [LISTING] Hidden: ${result.rows[0].request_id} by seller ${req.user.email}`);
    return res.status(200).json({ message: 'Listing hidden successfully', listing: result.rows[0] });
  } catch (error) {
    console.error('❌ [LISTING] Hide error:', error.message);
    return res.status(500).json({ message: 'Failed to hide listing' });
  }
};

const unhideListing = async (req, res) => {
  try {
    const { id } = req.params;
    const seller_id = req.user.id;

    const result = await pool.query(
      `UPDATE listings SET is_hidden = false, updated_at = NOW()
       WHERE id = $1 AND seller_id = $2 RETURNING *`,
      [id, seller_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found or not owned by you' });
    }

    // Re-credit wallet if previously reversed
    try {
      await recreditListingUnhide(seller_id, id);
    } catch (wErr) {
      console.warn('⚠️ [WALLET] Re-credit on unhide failed:', wErr.message);
    }

    console.log(`👁️ [LISTING] Unhidden: ${result.rows[0].request_id} by seller ${req.user.email}`);
    return res.status(200).json({ message: 'Listing unhidden successfully', listing: result.rows[0] });
  } catch (error) {
    console.error('❌ [LISTING] Unhide error:', error.message);
    return res.status(500).json({ message: 'Failed to unhide listing' });
  }
};

const adminDeleteListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE listings SET status = 'deleted', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = result.rows[0];

    // Reverse wallet credit for seller if credited
    try {
      if (listing.seller_id) {
        await reverseListingCredit(listing.seller_id, id, 'deleted');
      }
    } catch (wErr) {
      console.warn('⚠️ [WALLET] Reversal on admin delete failed:', wErr.message);
    }

    console.log(`🗑️ [ADMIN LISTING] Soft-deleted: ${listing.request_id} by admin ${req.user.email}`);
    return res.status(200).json({ message: 'Listing soft-deleted successfully', listing });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete listing' });
  }
};

const adminHideListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE listings SET is_hidden = true, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = result.rows[0];

    // Reverse wallet credit
    try {
      if (listing.seller_id) {
        await reverseListingCredit(listing.seller_id, id, 'hidden');
      }
    } catch (wErr) {
      console.warn('⚠️ [WALLET] Reversal on admin hide failed:', wErr.message);
    }

    console.log(`👁️ [ADMIN LISTING] Hidden: ${listing.request_id} by admin ${req.user.email}`);
    return res.status(200).json({ message: 'Listing hidden successfully', listing });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Hide error:', error.message);
    return res.status(500).json({ message: 'Failed to hide listing' });
  }
};

const adminUnhideListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const result = await pool.query(
      `UPDATE listings SET is_hidden = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const listing = result.rows[0];

    // Re-credit wallet
    try {
      if (listing.seller_id) {
        await recreditListingUnhide(listing.seller_id, id);
      }
    } catch (wErr) {
      console.warn('⚠️ [WALLET] Re-credit on admin unhide failed:', wErr.message);
    }

    console.log(`👁️ [ADMIN LISTING] Unhidden: ${listing.request_id} by admin ${req.user.email}`);
    return res.status(200).json({ message: 'Listing unhidden successfully', listing });
  } catch (error) {
    console.error('❌ [ADMIN LISTING] Unhide error:', error.message);
    return res.status(500).json({ message: 'Failed to unhide listing' });
  }
};

const getListingById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT l.*, c.name as category_name
       FROM listings l
       LEFT JOIN categories c ON l.category_id = c.id
       WHERE l.id = $1
         AND l.seller_id = $2`,
      [id, req.user.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

const adminGetListingById = async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    const result = await pool.query(
      `SELECT l.*, c.name as category_name,
        u.full_name as seller_name,
        u.company_name as seller_company,
        u.email as seller_email
       FROM listings l
       LEFT JOIN categories c ON l.category_id = c.id
       LEFT JOIN users u ON l.seller_id = u.id
       WHERE l.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ message: 'Not found' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

// ── Maker-Checker: Admin views, approves, rejects pending listing updates ────────────────

/**
 * GET /api/listings/admin/pending-updates
 * Returns all listings with update_status = 'pending'
 */
const adminGetPendingUpdates = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const result = await pool.query(
      `SELECT l.*, u.full_name as seller_name, u.company_name as seller_company, u.vat_number as seller_vat
       FROM listings l
       LEFT JOIN users u ON l.seller_id = u.id
       WHERE l.update_status = 'pending'
       ORDER BY l.updated_at DESC`
    );
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [LISTING] Pending updates error:', error.message);
    return res.status(500).json({ message: 'Failed to fetch pending updates' });
  }
};

/**
 * PUT /api/listings/admin/approve-update/:id
 * Merges pending_updates into main listing fields
 */
const adminApproveUpdate = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const listingRes = await pool.query('SELECT seller_id, request_id, pending_updates, seller_bid_price, buyer_visible_min, buyer_visible_max FROM listings WHERE id = $1', [id]);
    if (listingRes.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    const { seller_id, request_id, pending_updates, seller_bid_price: old_price, buyer_visible_min: old_min, buyer_visible_max: old_max } = listingRes.rows[0];
    if (!pending_updates) {
      return res.status(400).json({ message: 'No pending updates to approve' });
    }

    const u = pending_updates;
    
    // Sanitize fields before DB update
    const category_id_clean = (u.category_id === '') ? null : u.category_id;
    const year_clean = (u.year === '') ? null : u.year;
    const warranty_months_clean = (u.warranty_months === '') ? null : u.warranty_months;
    const application_clean = Array.isArray(u.application) ? u.application : (u.application ? [u.application] : []);

    // Price recalculation logic
    let new_seller_price = (u.seller_bid_price !== undefined && u.seller_bid_price !== null) ? parseFloat(u.seller_bid_price) : parseFloat(old_price);
    let new_buyer_min = old_min;
    let new_buyer_max = old_max;

    // If price changed, recalculate standard margins
    if (u.seller_bid_price && parseFloat(u.seller_bid_price) !== parseFloat(old_price)) {
      new_buyer_min = new_seller_price * 0.95;
      new_buyer_max = new_seller_price * 1.25;
    }

    const result = await pool.query(
      `UPDATE listings SET
        name              = COALESCE($1, name),
        description       = COALESCE($2, description),
        oem               = COALESCE($3, oem),
        make              = COALESCE($4, make),
        manufacturer      = COALESCE($5, manufacturer),
        condition         = COALESCE($6, condition),
        year              = COALESCE($7, year),
        eta               = COALESCE($8, eta),
        availability      = COALESCE($9, availability),
        application       = COALESCE($10, application),
        seller_bid_price  = $11,
        buyer_visible_min = $12,
        buyer_visible_max = $13,
        category_id       = $14,
        images            = COALESCE($15, images),
        document_url         = COALESCE($16, document_url),
        warranty_months   = COALESCE($17, warranty_months),
        pending_updates   = NULL,
        update_status     = 'none',
        updated_at        = NOW()
      WHERE id = $18 RETURNING *`,
      [
        u.name, u.description, u.oem, u.make, u.manufacturer,
        u.condition, year_clean, u.eta, u.availability, application_clean,
        new_seller_price, new_buyer_min, new_buyer_max, category_id_clean, u.images,
        u.document_url, warranty_months_clean, id
      ]
    );

    // Send notification to seller
    try {
      await createNotification(
        seller_id,
        "Update Approved ✅",
        `Your update request for listing ${request_id} has been approved.`,
        "listing",
        "/dashboard/inventory"
      );
    } catch (notifErr) {
      console.warn('⚠️ [ADMIN LISTING] Notification send failed:', notifErr.message);
    }

    console.log(`✅ [LISTING] Update approved for listing ${id}`);
    return res.status(200).json({ message: 'Listing update approved', listing: result.rows[0] });
  } catch (error) {
    console.error('❌ [LISTING] Approve update error:', error.message);
    return res.status(500).json({ message: 'Failed to approve update' });
  }
};

/**
 * PUT /api/listings/admin/reject-update/:id
 * Clears pending_updates and sets update_status = 'rejected'
 */
const adminRejectUpdate = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const { reason } = req.body;
    
    const checkRes = await pool.query('SELECT seller_id, request_id FROM listings WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    const { seller_id, request_id } = checkRes.rows[0];

    const result = await pool.query(
      `UPDATE listings SET 
        pending_updates = NULL, 
        update_status = 'rejected',
        updated_at = NOW()
      WHERE id = $1 RETURNING id, update_status`,
      [id]
    );

    // Send notification to seller
    try {
      await createNotification(
        seller_id,
        "Update Rejected ❌",
        `Your update request for listing ${request_id} was rejected.${reason ? ' Reason: ' + reason.trim() : ''}`,
        "listing",
        "/dashboard/inventory"
      );
    } catch (notifErr) {
      console.warn('⚠️ [ADMIN LISTING] Notification send failed:', notifErr.message);
    }

    console.log(`❌ [LISTING] Update rejected for listing ${id}${reason ? ': ' + reason : ''}`);
    return res.status(200).json({ message: 'Listing update rejected', listing: result.rows[0] });
  } catch (error) {
    console.error('❌ [LISTING] Reject update error:', error.message);
    return res.status(500).json({ message: 'Failed to reject update' });
  }
};

// --- PROMOTED ADS CONTROLLERS ---
const getPromotedListings = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.id, l.name, l.description, l.make, l.oem, 
        l.condition, l.year, l.quantity, l.seller_bid_price as price, l.status, 
        l.request_id, l.created_at, l.is_promoted, l.images, l.promoted_image,
        c.name as category_name
      FROM listings l
      LEFT JOIN categories c ON l.category_id = c.id
      WHERE l.status = 'approved' AND l.is_hidden = false AND l.is_promoted = true
      ORDER BY l.created_at DESC
      LIMIT 20
    `);
    
    return res.status(200).json({
      message: 'Promoted listings retrieved successfully',
      listings: result.rows
    });
  } catch (error) {
    console.error('Error fetching promoted listings:', error);
    return res.status(500).json({ error: 'Failed to fetch promoted listings' });
  }
};

const adminTogglePromoteListing = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can toggle promotions' });
    }
    
    const { id } = req.params;
    const { is_promoted, promoted_image } = req.body;
    
    const result = await pool.query(`
      UPDATE listings 
      SET is_promoted = $1, promoted_image = $2
      WHERE id = $3
      RETURNING id, name, is_promoted, promoted_image
    `, [is_promoted, is_promoted ? promoted_image || null : null, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    
    return res.status(200).json({
      message: 'Listing promotion status updated successfully',
      listing: result.rows[0]
    });
  } catch (error) {
    console.error('Error toggling listing promotion:', error);
    return res.status(500).json({ error: 'Failed to update listing promotion status' });
  }
};

module.exports = {
  getPromotedListings,
  adminTogglePromoteListing,
  bulkUploadListings,
  createListing,
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
};
