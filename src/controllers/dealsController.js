const pool = require('../config/database');
const { uploadFile } = require('../services/storageService');
const { getOrCreateWallet, applyDealWalletDiscount, releaseDealWalletDiscount } = require('../services/walletService');
const { generateProformaPdf } = require('../services/proformaPdfService');
const { getBankDetails } = require('../services/platformSettingsService');
const { sendProformaToBuyerEmail } = require('../services/emailService');

// Helper to generate unique deal ID
const generateUniqueDealId = async () => {
  let dealId;
  let isUnique = false;
  
  while (!isUnique) {
    const random = Math.floor(1000 + Math.random() * 9000);
    dealId = `DEAL-${random}`;
    const result = await pool.query('SELECT id FROM deals WHERE deal_id = $1', [dealId]);
    isUnique = result.rows.length === 0;
  }
  
  return dealId;
};

// --- USER CONTROLLERS (SELLER/BUYER) ---

const getMyDeals = async (req, res) => {
  try {
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const baseSelect = `
      id, deal_id, stage, status, created_at, final_price, base_amount,
      wallet_discount, special_discount, proforma_url, proforma_date, proforma_locked,
      quantity, unit_price
    `;

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      const dataResult = await pool.query(
        `SELECT ${baseSelect}
         FROM deals 
         WHERE seller_id = $1 OR buyer_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2 OFFSET $3`,
        [req.user.id, safeLimit, offset]
      );

      const countResult = await pool.query(
        'SELECT COUNT(*) FROM deals WHERE seller_id = $1 OR buyer_id = $1',
        [req.user.id]
      );

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
      const result = await pool.query(
        `SELECT ${baseSelect}
         FROM deals 
         WHERE seller_id = $1 OR buyer_id = $1 
         ORDER BY created_at DESC`,
        [req.user.id]
      );
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [DEAL] Get my deals error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve your deals' });
  }
};

// --- ADMIN CONTROLLERS ---

const adminGetAllDeals = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const page = req.query.page ? parseInt(req.query.page) : null;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;

    const baseFields = `
      d.id, d.deal_id, d.stage, d.status, d.created_at, d.final_price,
      d.base_amount, d.wallet_discount, d.special_discount,
      d.proforma_url, d.proforma_date, d.proforma_edit_count, d.proforma_locked, d.proforma_data,
      d.revenue_model, d.seller_payout, d.warex_revenue, d.quantity, d.unit_price, d.commission_rate,
      d.nda_status, d.seller_nda_doc, d.buyer_nda_doc,
      d.dispatch_doc_url, d.dispatch_photo_url, d.material_receipt_url,
      s.full_name as seller_name, s.company_name as seller_company, s.vat_number as seller_vat, s.email as seller_email,
      b.full_name as buyer_name, b.company_name as buyer_company, b.vat_number as buyer_vat, b.email as buyer_email, b.mobile as buyer_mobile, b.address as buyer_address,
      l.name as listing_name, l.request_id as listing_request_id, l.seller_bid_price as listing_seller_price, l.oem as listing_oem,
      br.budget_max as buyer_original_quote, br.quantity as buyer_original_quantity
    `;
    const fromClause = `
      FROM deals d
      LEFT JOIN users s ON d.seller_id = s.id
      LEFT JOIN users b ON d.buyer_id = b.id
      LEFT JOIN listings l ON d.listing_id = l.id
      LEFT JOIN buyer_requests br ON d.buyer_request_id = br.id
    `;

    if (page && !isNaN(page) && page > 0) {
      const safeLimit = (limit && !isNaN(limit) && limit > 0) ? limit : 20;
      const offset = (page - 1) * safeLimit;
      
      const dataResult = await pool.query(
        `SELECT ${baseFields} ${fromClause} ORDER BY d.created_at DESC LIMIT $1 OFFSET $2`,
        [safeLimit, offset]
      );

      const countResult = await pool.query('SELECT COUNT(*) FROM deals');
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
      const result = await pool.query(`SELECT ${baseFields} ${fromClause} ORDER BY d.created_at DESC`);
      return res.status(200).json(result.rows);
    }
  } catch (error) {
    console.error('❌ [ADMIN DEAL] Get all error:', error.message);
    return res.status(500).json({ message: 'Failed to retrieve deals' });
  }
};

/**
 * Helper to generate & upload Proforma PDF for a deal
 */
const generateAndSaveProforma = async (dealId, adminUser, isRevised = false) => {
  const query = `
    SELECT d.*, 
      br.request_id as request_id, br.request_id as rfq_id,
      s.full_name as seller_name, s.company_name as seller_company, s.email as seller_email,
      b.full_name as buyer_name, b.company_name as buyer_company, b.email as buyer_email, b.mobile as buyer_mobile, b.address as buyer_address, b.vat_number as buyer_vat, b.pan_number as buyer_pan,
      l.name as listing_name, l.oem as listing_oem, l.seller_bid_price as listing_price
    FROM deals d
    LEFT JOIN buyer_requests br ON d.buyer_request_id = br.id
    LEFT JOIN users s ON d.seller_id = s.id
    LEFT JOIN users b ON d.buyer_id = b.id
    LEFT JOIN listings l ON d.listing_id = l.id
    WHERE d.id = $1
  `;
  const res = await pool.query(query, [dealId]);
  if (res.rows.length === 0) throw new Error('Deal not found');

  const deal = res.rows[0];
  const buyer = {
    company_name: deal.buyer_company,
    full_name: deal.buyer_name,
    email: deal.buyer_email,
    mobile: deal.buyer_mobile,
    address: deal.buyer_address,
    vat_number: deal.buyer_vat,
    pan_number: deal.buyer_pan
  };
  const seller = {
    company_name: deal.seller_company,
    full_name: deal.seller_name
  };
  const listing = {
    name: deal.listing_name,
    oem: deal.listing_oem
  };

  const { getBankAccountById } = require('../services/platformSettingsService');
  const bankDetails = await getBankAccountById(deal.bank_account_id);
  
  let items = [];
  if (deal.proforma_data && Array.isArray(deal.proforma_data.items)) {
    items = deal.proforma_data.items;
  }

  const pdfBuffer = await generateProformaPdf({
    deal,
    buyer,
    seller,
    listing,
    items,
    bankDetails,
    printedBy: adminUser?.full_name || 'WareXhub Admin'
  });

  // Upload to Supabase Storage with predictable naming & private access
  const fileName = `WarexHub_Proforma-${deal.deal_id}.pdf`;
  const storagePath = `proformas/${deal.id}/${fileName}`;
  const { url } = await uploadFile({
    buffer: pdfBuffer,
    originalname: fileName,
    mimetype: 'application/pdf',
    type: 'agreement',
    customPath: storagePath,
    isPrivate: true
  });

  // Update deal with proforma_url and date
  await pool.query(
    `UPDATE deals 
     SET proforma_url = $1, proforma_date = NOW(), updated_at = NOW() 
     WHERE id = $2`,
    [url, dealId]
  );

  // Send Proforma PDF & details email to buyer
  if (buyer.email) {
    try {
      await sendProformaToBuyerEmail(buyer, { ...deal, proforma_url: url }, pdfBuffer, url, isRevised || deal.proforma_edit_count > 0);
      console.log(`📧 [PROFORMA EMAIL] Sent Proforma for ${deal.deal_id} to ${buyer.email} (Revised: ${isRevised || deal.proforma_edit_count > 0})`);
    } catch (emailErr) {
      console.error('⚠️ [PROFORMA EMAIL] Failed to send email to buyer:', emailErr.message);
    }
  }

  return { url, pdfBuffer, deal: { ...deal, proforma_url: url } };
};

/**
 * GET /api/deals/:id/proforma-pdf
 * Authenticated streaming endpoint for logged-in Admin or Buyer
 */
const getDealProformaPdf = async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT d.*, 
        br.request_id as request_id, br.request_id as rfq_id,
        s.full_name as seller_name, s.company_name as seller_company, s.email as seller_email,
        b.full_name as buyer_name, b.company_name as buyer_company, b.email as buyer_email, b.mobile as buyer_mobile, b.address as buyer_address, b.vat_number as buyer_vat, b.pan_number as buyer_pan,
        l.name as listing_name, l.oem as listing_oem, l.seller_bid_price as listing_price
      FROM deals d
      LEFT JOIN buyer_requests br ON d.buyer_request_id = br.id
      LEFT JOIN users s ON d.seller_id = s.id
      LEFT JOIN users b ON d.buyer_id = b.id
      LEFT JOIN listings l ON d.listing_id = l.id
      WHERE d.id::text = $1 OR d.deal_id = $1
    `;
    const dealRes = await pool.query(query, [id]);
    if (dealRes.rows.length === 0) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    const deal = dealRes.rows[0];

    // Auth check: Admin, Reviewer or the Deal's Buyer
    if (req.user.role !== 'admin' && req.user.role !== 'reviewer' && req.user.id !== deal.buyer_id) {
      return res.status(403).json({ message: 'Access denied to this Proforma PDF' });
    }

    const buyer = {
      company_name: deal.buyer_company,
      full_name: deal.buyer_name,
      email: deal.buyer_email,
      mobile: deal.buyer_mobile,
      address: deal.buyer_address,
      vat_number: deal.buyer_vat,
      pan_number: deal.buyer_pan
    };
    const seller = { company_name: deal.seller_company, full_name: deal.seller_name };
    const listing = { name: deal.listing_name, oem: deal.listing_oem };

    const { getBankAccountById } = require('../services/platformSettingsService');
    const bankDetails = await getBankAccountById(deal.bank_account_id);

    let items = [];
    if (deal.proforma_data && Array.isArray(deal.proforma_data.items)) {
      items = deal.proforma_data.items;
    }

    const pdfBuffer = await generateProformaPdf({
      deal,
      buyer,
      seller,
      listing,
      items,
      bankDetails,
      printedBy: req.user.full_name || 'WareXhub Operations'
    });

    if (!pdfBuffer || pdfBuffer.length === 0) {
      return res.status(404).json({ message: 'PDF not found' });
    }

    const filename = `WarexHub_Proforma-${deal.deal_id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('❌ [PROFORMA STREAM] Error:', error.message);
    return res.status(404).json({ message: 'PDF not found' });
  }
};

/**
 * Admin creates a new Deal.
 * Automatically checks buyer wallet, calculates 10% cap, creates deal, generates Proforma PDF.
 */
const adminCreateDeal = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    let {
      quote_id, listing_id, buyer_request_id,
      seller_id, buyer_id, final_price, unit_price, quantity,
      commission_rate, revenue_model,
      apply_wallet_discount, wallet_discount, special_discount, base_amount,
      delivery_address, delivery_time,
      bank_account_id
    } = req.body;

    // If seller_id is missing but we have items or listing, fetch it
    if (!seller_id && req.body.items && req.body.items.length > 0) {
      const firstWithSeller = req.body.items.find(i => i.seller_id);
      if (firstWithSeller) seller_id = firstWithSeller.seller_id;
    }

    if (!seller_id && listing_id) {
      const listingRes = await pool.query('SELECT seller_id FROM listings WHERE id = $1', [listing_id]);
      if (listingRes.rows.length > 0) {
        seller_id = listingRes.rows[0].seller_id;
      }
    }

    if (!listing_id && req.body.items && req.body.items.length > 0) {
      const firstWithListing = req.body.items.find(i => i.listing_id);
      if (firstWithListing) listing_id = firstWithListing.listing_id;
    }

    if (!seller_id || !buyer_id) {
      return res.status(400).json({ message: 'Seller ID and Buyer ID are required to create a deal' });
    }

    // Resolve buyer_request UUID and batch_id safely
    let validBuyerRequestId = null;
    let targetBatchId = null;
    if (buyer_request_id) {
      const brRes = await pool.query(
        'SELECT id, batch_id FROM buyer_requests WHERE id::text = $1 OR request_id = $1 OR batch_id = $1 LIMIT 1',
        [buyer_request_id]
      );
      if (brRes.rows.length > 0) {
        validBuyerRequestId = brRes.rows[0].id;
        targetBatchId = brRes.rows[0].batch_id;
      }
    }

    // Prepare proforma_data jsonb object for multi-item batches
    let proformaDataObj = null;
    if (req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0) {
      proformaDataObj = {
        is_batch: true,
        batch_id: targetBatchId || buyer_request_id,
        items: req.body.items.map((it, idx) => ({
          sn: idx + 1,
          listing_id: it.listing_id,
          description: it.item_name || it.description || 'Industrial Material',
          item_name: it.item_name,
          oem: it.oem || '',
          quantity: parseFloat(it.quantity) || 1,
          unitPrice: parseFloat(it.unit_price) || 0,
          unit_price: parseFloat(it.unit_price) || 0,
          seller_id: it.seller_id,
          seller_name: it.seller_name,
          seller_company: it.seller_company,
          seller_payout: parseFloat(it.seller_payout) || 0
        }))
      };
    }
    
    const deal_id = await generateUniqueDealId();
    const qty = parseFloat(quantity) || 1;
    const unitPrice = parseFloat(unit_price) || 0;
    
    // Base amount before discounts
    const computedBaseAmount = parseFloat(base_amount) || (unitPrice * qty) || parseFloat(final_price) || 0;

    // ── Wallet Discount Calculation ──
    const buyerWallet = await getOrCreateWallet(buyer_id);
    const walletBalance = parseFloat(buyerWallet.balance) || 0;
    const maxEligibleWalletDisc = Math.min(walletBalance, Math.round(0.10 * computedBaseAmount * 100) / 100);

    let appliedWalletDisc = 0;
    if (apply_wallet_discount === true || apply_wallet_discount === 'true' || parseFloat(wallet_discount) > 0) {
      const requestedDisc = parseFloat(wallet_discount) || maxEligibleWalletDisc;
      appliedWalletDisc = Math.min(maxEligibleWalletDisc, requestedDisc);
    }

    const appliedSpecialDisc = parseFloat(special_discount) || 0;
    const computedFinalPrice = Math.max(0, computedBaseAmount - appliedWalletDisc - appliedSpecialDisc);

    let warexRevenue = 0;
    let sellerPayout = parseFloat(req.body.seller_payout) || 0;
    let commRate = parseFloat(commission_rate) || 0;
    let commAmount = 0;

    if (revenue_model === 'margin') {
      warexRevenue = computedFinalPrice - sellerPayout;
      commRate = 0;
      commAmount = 0;
    } else {
      commRate = commRate || 10;
      commAmount = (computedFinalPrice * commRate) / 100;
      warexRevenue = commAmount;
      sellerPayout = computedFinalPrice - commAmount;
    }

    const result = await pool.query(
      `INSERT INTO deals (
        deal_id, quote_id, listing_id, buyer_request_id,
        seller_id, buyer_id, final_price, deal_value, 
        base_amount, wallet_discount, special_discount,
        commission_rate, commission_amount, warex_revenue, seller_payout,
        revenue_model, stage, status, quantity, unit_price,
        proforma_edit_count, proforma_locked, proforma_date,
        delivery_address, delivery_time, bank_account_id, proforma_data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), $23, $24, $25, $26)
      RETURNING *`,
      [
        deal_id, 
        quote_id || null, 
        listing_id || null, 
        validBuyerRequestId || null,
        seller_id, 
        buyer_id, 
        computedFinalPrice, 
        computedFinalPrice,
        computedBaseAmount,
        appliedWalletDisc,
        appliedSpecialDisc,
        commRate,
        commAmount,
        warexRevenue,
        sellerPayout,
        revenue_model || 'margin',
        'proforma_generated',
        'new',
        qty,
        unitPrice,
        0,
        false,
        delivery_address || null,
        delivery_time || '3-7 Working Days',
        bank_account_id || null,
        proformaDataObj ? JSON.stringify(proformaDataObj) : null
      ]
    );
    
    const createdDeal = result.rows[0];

    // Auto-deduct quantity from listing(s) and hide if out of stock
    if (req.body.items && Array.isArray(req.body.items) && req.body.items.length > 0) {
      for (const it of req.body.items) {
        if (it.listing_id) {
          const itQty = parseFloat(it.quantity) || 1;
          await pool.query(
            `UPDATE listings 
             SET quantity = GREATEST(quantity - $1, 0),
                 is_hidden = CASE WHEN (quantity - $1) <= 0 THEN true ELSE is_hidden END,
                 updated_at = NOW()
             WHERE id = $2`,
            [itQty, it.listing_id]
          );
          console.log(`📉 [STOCK DEDUCTED] Deducted ${itQty} units from listing ${it.listing_id} for batch deal ${deal_id}`);
        }
      }
    } else if (listing_id) {
      await pool.query(
        `UPDATE listings 
         SET quantity = GREATEST(quantity - $1, 0),
             is_hidden = CASE WHEN (quantity - $1) <= 0 THEN true ELSE is_hidden END,
             updated_at = NOW()
         WHERE id = $2`,
        [qty, listing_id]
      );
      console.log(`📉 [STOCK DEDUCTED] Deducted ${qty} units from listing ${listing_id} for deal ${deal_id}`);
    }
    
    // Update buyer request status if linked
    if (targetBatchId) {
      await pool.query('UPDATE buyer_requests SET status = $1, updated_at = NOW() WHERE batch_id = $2', ['matched', targetBatchId]);
      console.log(`✅ [BATCH STATUS] Updated all requests in batch ${targetBatchId} to 'matched'`);
    } else if (validBuyerRequestId) {
      await pool.query('UPDATE buyer_requests SET status = $1, updated_at = NOW() WHERE id = $2', ['matched', validBuyerRequestId]);
    }

    // Auto-debit / hold buyer wallet discount immediately on Deal/Proforma creation
    if (appliedWalletDisc > 0) {
      try {
        await applyDealWalletDiscount(buyer_id, createdDeal.id, appliedWalletDisc);
        console.log(`💰 [WALLET] Auto-debited NPR ${appliedWalletDisc} from buyer ${buyer_id} for new deal ${deal_id}`);
      } catch (wErr) {
        console.warn('⚠️ [WALLET DEBIT] Error debiting wallet on deal creation:', wErr.message);
      }
    }

    // Automatically generate and upload Proforma PDF
    let proformaUrl = null;
    try {
      const proformaRes = await generateAndSaveProforma(createdDeal.id, req.user);
      proformaUrl = proformaRes.url;
      createdDeal.proforma_url = proformaUrl;
    } catch (pdfErr) {
      console.error('⚠️ [DEAL PROFORMA] Initial PDF generation failed:', pdfErr.message);
    }

    console.log(`✅ [DEAL] Deal ${deal_id} created in stage 'proforma_generated'. Base: ${computedBaseAmount}, Wallet Disc: ${appliedWalletDisc}, Special Disc: ${appliedSpecialDisc}, Final: ${computedFinalPrice}`);

    return res.status(201).json({
      message: 'Deal created & Proforma generated successfully',
      deal: createdDeal,
      proforma_url: proformaUrl
    });
  } catch (error) {
    console.error('❌ [ADMIN DEAL] Create error detailed:', error);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({ message: isProd ? 'Failed to create deal. Please try again.' : `Failed to create deal: ${error.message}` });
  }
};

/**
 * POST /api/deals/admin/:id/generate-proforma
 * Regenerates the Proforma PDF and uploads to storage
 */
const adminGenerateProforma = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const proformaRes = await generateAndSaveProforma(id, req.user);

    return res.status(200).json({
      message: 'Proforma PDF generated successfully',
      url: proformaRes.url,
      deal: proformaRes.deal
    });
  } catch (error) {
    console.error('❌ [PROFORMA GENERATE] Error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to generate Proforma PDF' });
  }
};

/**
 * GET /api/deals/admin/:id/proforma-url
 * Returns proforma_url, generating it if not yet created.
 */
const adminGetProformaUrl = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const dealRes = await pool.query('SELECT id, deal_id, proforma_url FROM deals WHERE id::text = $1 OR deal_id = $1', [id]);
    if (dealRes.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    const deal = dealRes.rows[0];

    if (deal.proforma_url) {
      return res.status(200).json({ url: deal.proforma_url, proforma_url: deal.proforma_url });
    }

    const proformaRes = await generateAndSaveProforma(deal.id, req.user);
    return res.status(200).json({ url: proformaRes.url, proforma_url: proformaRes.url });
  } catch (error) {
    console.error('❌ [PROFORMA URL] Error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to get Proforma URL' });
  }
};

/**
 * PUT /api/deals/admin/:id/negotiate
 * Admin updates negotiation terms (Special Discount, Wallet Discount).
 * Enforces: Editable exactly once! Permanently locked after second finalization.
 */
const adminNegotiateDeal = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;
    const { special_discount, wallet_discount, apply_wallet_discount } = req.body;

    const dealRes = await pool.query('SELECT * FROM deals WHERE id = $1', [id]);
    if (dealRes.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }

    const deal = dealRes.rows[0];

    // Enforce Proforma Lock
    if (deal.proforma_locked) {
      return res.status(400).json({ message: 'This Proforma is permanently locked and cannot be edited further.' });
    }

    // Enforce Single Edit Rule (proforma_edit_count <= 1)
    if (deal.proforma_edit_count >= 1) {
      return res.status(400).json({
        message: 'Proforma can be edited exactly once during negotiation. It has already been edited.'
      });
    }

    const baseAmount = parseFloat(deal.base_amount) || (parseFloat(deal.unit_price) * parseFloat(deal.quantity)) || parseFloat(deal.final_price);

    // Wallet discount
    let newWalletDisc = parseFloat(deal.wallet_discount) || 0;
    if (apply_wallet_discount === false || apply_wallet_discount === 'false') {
      newWalletDisc = 0;
    } else if (wallet_discount !== undefined) {
      const buyerWallet = await getOrCreateWallet(deal.buyer_id);
      const balance = parseFloat(buyerWallet.balance) || 0;
      const maxEligible = Math.min(balance, 0.10 * baseAmount);
      newWalletDisc = Math.min(maxEligible, parseFloat(wallet_discount) || 0);
    }

    const newSpecialDisc = parseFloat(special_discount) !== undefined ? (parseFloat(special_discount) || 0) : (parseFloat(deal.special_discount) || 0);
    
    // Bounds check
    if (newSpecialDisc < 0) {
      return res.status(400).json({ message: 'Special discount cannot be negative' });
    }
    if (newWalletDisc + newSpecialDisc > baseAmount) {
      return res.status(400).json({ message: 'Total discounts cannot exceed the base deal amount' });
    }

    const newFinalPrice = Math.max(0, baseAmount - newWalletDisc - newSpecialDisc);

    // Recalculate seller payout / warex revenue
    let warexRevenue = deal.warex_revenue;
    let sellerPayout = deal.seller_payout;
    if (deal.revenue_model === 'margin') {
      warexRevenue = newFinalPrice - sellerPayout;
    } else {
      const commRate = parseFloat(deal.commission_rate) || 10;
      const commAmount = (newFinalPrice * commRate) / 100;
      warexRevenue = commAmount;
      sellerPayout = newFinalPrice - commAmount;
    }

    // Update deal
    await pool.query(
      `UPDATE deals SET 
        special_discount = $1,
        wallet_discount = $2,
        final_price = $3,
        deal_value = $3,
        warex_revenue = $4,
        seller_payout = $5,
        proforma_edit_count = proforma_edit_count + 1,
        proforma_locked = true,
        stage = 'finalized',
        updated_at = NOW()
      WHERE id = $6`,
      [newSpecialDisc, newWalletDisc, newFinalPrice, warexRevenue, sellerPayout, id]
    );

    // Auto-adjust wallet ledger when proforma is locked
    try {
      const prevDebitRes = await pool.query(
        `SELECT COALESCE(SUM(ABS(amount)), 0) as total_debited 
         FROM wallet_transactions 
         WHERE related_deal_id = $1 AND type = 'debit_purchase'`,
        [deal.id]
      );
      const prevDebited = parseFloat(prevDebitRes.rows[0]?.total_debited) || 0;
      const diff = newWalletDisc - prevDebited;

      if (diff > 0) {
        await applyDealWalletDiscount(deal.buyer_id, deal.id, diff);
        console.log(`💰 [WALLET LOCK] Debited additional NPR ${diff} for locked deal ${deal.deal_id}`);
      } else if (diff < 0) {
        await releaseDealWalletDiscount(deal.buyer_id, deal.id, Math.abs(diff));
        console.log(`🔄 [WALLET LOCK] Refunded excess NPR ${Math.abs(diff)} for revised deal ${deal.deal_id}`);
      }
    } catch (wErr) {
      console.warn('⚠️ [WALLET LOCK] Error updating wallet discount:', wErr.message);
    }

    // Regenerate Proforma PDF with updated values (Revised proforma)
    const proformaRes = await generateAndSaveProforma(id, req.user, true);

    console.log(`📝 [DEAL NEGOTIATION] Deal ${deal.deal_id} negotiated & finalized: Base=${baseAmount}, WalletDisc=${newWalletDisc}, SpecialDisc=${newSpecialDisc}, Final=${newFinalPrice}`);

    return res.status(200).json({
      message: 'Proforma updated with negotiation terms and finalized (locked)',
      deal: proformaRes.deal,
      proforma_url: proformaRes.url
    });
  } catch (error) {
    console.error('❌ [DEAL NEGOTIATION] Error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to update negotiation terms' });
  }
};

/**
 * PUT /api/deals/admin/:id/finalize-proforma
 * Locks the proforma without editing
 */
const adminFinalizeProforma = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE deals 
       SET proforma_locked = true, stage = 'finalized', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Deal not found' });

    const deal = result.rows[0];
    const walletDisc = parseFloat(deal.wallet_discount) || 0;
    if (walletDisc > 0) {
      try {
        const alreadyDebited = await pool.query(
          `SELECT 1 FROM wallet_transactions WHERE related_deal_id = $1 AND type = 'debit_purchase'`,
          [deal.id]
        );
        if (alreadyDebited.rows.length === 0) {
          await applyDealWalletDiscount(deal.buyer_id, deal.id, walletDisc);
          console.log(`💰 [WALLET LOCK] Debited NPR ${walletDisc} on finalize/lock for deal ${deal.deal_id}`);
        }
      } catch (wErr) {
        console.warn('⚠️ [WALLET LOCK] Error debiting on finalize:', wErr.message);
      }
    }

    return res.status(200).json({
      message: 'Proforma finalized & locked',
      deal: deal
    });
  } catch (error) {
    console.error('❌ [PROFORMA FINALIZE] Error:', error.message);
    return res.status(500).json({ message: 'Failed to finalize proforma' });
  }
};

/**
 * POST /api/deals/admin/:id/initiate-and-email
 * Finalizes initiation: debits buyer wallet (if discount applied), moves to 'initiated', and emails buyer.
 */
const adminInitiateAndEmail = async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;

    await client.query('BEGIN');

    const dealRes = await client.query('SELECT * FROM deals WHERE id = $1 FOR UPDATE', [id]);
    if (dealRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Deal not found' });
    }

    const deal = dealRes.rows[0];

    // 1. Debit buyer wallet if wallet discount was applied and not yet debited
    const walletDisc = parseFloat(deal.wallet_discount) || 0;
    if (walletDisc > 0) {
      const alreadyDebited = await client.query(
        `SELECT 1 FROM wallet_transactions WHERE related_deal_id = $1 AND type = 'debit_purchase'`,
        [deal.id]
      );
      if (alreadyDebited.rows.length === 0) {
        await applyDealWalletDiscount(deal.buyer_id, deal.id, walletDisc, client);
      }
    }

    // 2. Transition stage to 'initiated'
    const updateRes = await client.query(
      `UPDATE deals 
       SET stage = 'initiated', proforma_locked = true, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query('COMMIT');

    const updatedDeal = updateRes.rows[0];

    // 3. Generate fresh PDF & Email Buyer (generateAndSaveProforma automatically emails the buyer)
    try {
      await generateAndSaveProforma(id, req.user);
    } catch (emailErr) {
      console.warn('⚠️ [DEAL INITIATE] Proforma generation/email failed:', emailErr.message);
    }

    console.log(`🚀 [DEAL] Deal ${deal.deal_id} initiated and emailed to buyer ${deal.buyer_id}`);

    return res.status(200).json({
      message: 'Deal initiated successfully and Proforma emailed to buyer',
      deal: updatedDeal
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [DEAL INITIATE] Error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to initiate deal' });
  } finally {
    client.release();
  }
};

/**
 * Helper to revert listing inventory and unhide listings for both single and batch deals.
 * Also reverts linked buyer request(s) to 'pending'.
 */
const restoreDealInventory = async (deal, client) => {
  let proformaData = deal.proforma_data;
  if (typeof proformaData === 'string') {
    try { proformaData = JSON.parse(proformaData); } catch (e) {}
  }

  // 1. Check if deal is a batch deal with items array
  if (proformaData && Array.isArray(proformaData.items) && proformaData.items.length > 0) {
    for (const it of proformaData.items) {
      if (it.listing_id) {
        const itQty = parseFloat(it.quantity) || 1;
        await client.query(
          `UPDATE listings 
           SET quantity = quantity + $1,
               is_hidden = CASE WHEN (quantity + $1) > 0 THEN false ELSE is_hidden END,
               updated_at = NOW()
           WHERE id = $2`,
          [itQty, it.listing_id]
        );
        console.log(`📈 [STOCK RESTORED] Restored ${itQty} units to listing ${it.listing_id} for batch deal ${deal.deal_id || deal.id}`);
      }
    }
  } else if (deal.listing_id) {
    // Single listing deal
    const qty = parseFloat(deal.quantity) || 1;
    await client.query(
      `UPDATE listings 
       SET quantity = quantity + $1,
           is_hidden = CASE WHEN (quantity + $1) > 0 THEN false ELSE is_hidden END,
           updated_at = NOW()
       WHERE id = $2`,
      [qty, deal.listing_id]
    );
    console.log(`📈 [STOCK RESTORED] Restored ${qty} units to listing ${deal.listing_id} for deal ${deal.deal_id || deal.id}`);
  }

  // 2. Revert buyer request status if linked
  if (proformaData && proformaData.batch_id) {
    await client.query('UPDATE buyer_requests SET status = $1, updated_at = NOW() WHERE batch_id = $2', ['pending', proformaData.batch_id]);
    console.log(`🔄 [REQUEST REVERTED] Reverted batch requests ${proformaData.batch_id} to 'pending'`);
  }
  if (deal.buyer_request_id) {
    await client.query('UPDATE buyer_requests SET status = $1, updated_at = NOW() WHERE id = $2 OR batch_id = $2', ['pending', deal.buyer_request_id]);
    console.log(`🔄 [REQUEST REVERTED] Reverted request ${deal.buyer_request_id} to 'pending'`);
  }
};

/**
 * PUT /api/deals/admin/:id/cancel-negotiation
 * Cancels/Drops a deal from negotiation. Releases wallet holds and restores inventory (single & multi).
 */
const adminCancelNegotiation = async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;

    await client.query('BEGIN');

    const dealRes = await client.query('SELECT * FROM deals WHERE id = $1 FOR UPDATE', [id]);
    if (dealRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Deal not found' });
    }

    const deal = dealRes.rows[0];

    // If deal is already cancelled, avoid double reverting
    if (deal.stage === 'cancelled' || deal.status === 'cancelled') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Deal is already cancelled' });
    }

    // 1. Release any wallet discount if debited
    await releaseDealWalletDiscount(deal.buyer_id, deal.id, client);

    // 2. Revert listing inventory & buyer requests for single or batch deals
    await restoreDealInventory(deal, client);

    // 3. Update deal stage to 'cancelled'
    const updateRes = await client.query(
      `UPDATE deals 
       SET stage = 'cancelled', status = 'cancelled', updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [id]
    );

    await client.query('COMMIT');

    console.log(`🛑 [DEAL] Deal ${deal.deal_id} cancelled/dropped by admin`);

    return res.status(200).json({
      message: 'Deal cancelled and dropped. Inventory restored and wallet holds released.',
      deal: updateRes.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [DEAL CANCEL] Error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to cancel deal' });
  } finally {
    client.release();
  }
};

const adminUpdateStage = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    const { stage, bypass_agreement } = req.body;
    
    const validStages = [
      'draft', 'proforma_generated', 'negotiation', 'finalized',
      'initiated', 'nda_signed', 'payment_pending', 'payment_done',
      'delivery', 'completed', 'closed', 'cancelled'
    ];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ message: `Invalid stage: ${stage}` });
    }

    // Block moving from nda_signed to payment_pending if Agreement is not uploaded (unless bypassed)
    if (stage === 'payment_pending') {
      const ndaCheck = await pool.query('SELECT nda_status FROM deals WHERE id = $1', [id]);
      if (ndaCheck.rows.length > 0 && ndaCheck.rows[0].nda_status !== 'both_signed') {
        if (!bypass_agreement) {
          return res.status(400).json({ 
            message: `Cannot proceed to ${stage} — Agreement document must be uploaded first.`,
            nda_required: true
          });
        }
      }
    }
    
    // If cancelling via stage update, restore inventory and wallet holds
    if (stage === 'cancelled') {
      const dealCheck = await pool.query('SELECT * FROM deals WHERE id = $1', [id]);
      if (dealCheck.rows.length === 0) {
        return res.status(404).json({ message: 'Deal not found' });
      }
      const existingDeal = dealCheck.rows[0];
      if (existingDeal.stage !== 'cancelled') {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await releaseDealWalletDiscount(existingDeal.buyer_id, existingDeal.id, client);
          await restoreDealInventory(existingDeal, client);
          const updateRes = await client.query(
            "UPDATE deals SET stage = 'cancelled', status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
            [id]
          );
          await client.query('COMMIT');
          return res.status(200).json({
            message: 'Deal stage updated to cancelled. Inventory restored and wallet holds released.',
            deal: updateRes.rows[0]
          });
        } catch (cErr) {
          await client.query('ROLLBACK');
          throw cErr;
        } finally {
          client.release();
        }
      }
    }

    let query = 'UPDATE deals SET stage = $1, updated_at = NOW()';
    let params = [stage, id];
    
    if (stage === 'completed') {
      const dealResult = await pool.query('SELECT final_price, commission_rate, seller_payout, seller_id, buyer_id, revenue_model FROM deals WHERE id = $1', [id]);
      if (dealResult.rows.length > 0) {
        const { final_price, commission_rate, seller_payout, seller_id, buyer_id } = dealResult.rows[0];
        
        let revenue = 0;
        let description = '';

        if (commission_rate && parseFloat(commission_rate) > 0) {
          revenue = (parseFloat(final_price) * parseFloat(commission_rate)) / 100;
          description = `Commission on deal ${id}`;
        } else if (seller_payout && parseFloat(seller_payout) > 0) {
          revenue = parseFloat(final_price) - parseFloat(seller_payout);
          description = `Margin on deal ${id} (Buyer: ${final_price}, Seller: ${seller_payout})`;
        }
        
        query = `UPDATE deals SET 
          stage = $1, 
          commission_amount = $3, 
          warex_revenue = $3, 
          closed_at = NOW(), 
          updated_at = NOW()`;
        params.push(revenue);
        
        await pool.query(
          `INSERT INTO commissions (
            deal_id, seller_id, buyer_id, deal_value, 
            commission_rate, commission_amount, total_revenue, status, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [id, seller_id, buyer_id, final_price, commission_rate || 0, revenue, revenue, 'pending']
        );

        if (revenue > 0) {
          await pool.query(
            `INSERT INTO revenue_log (source_type, reference_id, amount, description, created_by)
             VALUES ($1, $2, $3, $4, $5)`,
            ['deal', id, revenue, description, req.user.id]
          );
        }
      }
    }
    
    query += ' WHERE id = $2 RETURNING *';
    
    const result = await pool.query(query, params);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    
    return res.status(200).json({
      message: `Deal stage updated to ${stage}`,
      deal: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [ADMIN DEAL] Update stage error:', error.message);
    return res.status(500).json({ message: 'Failed to update deal stage' });
  }
};

const adminSetPrice = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    
    const { id } = req.params;
    const { 
      final_price, unit_price, quantity, 
      commission_rate, seller_payout, revenue_model 
    } = req.body;
    
    const finalPrice = parseFloat(final_price) || 0;
    const commRate = parseFloat(commission_rate) || 0;
    const inputSellerPayout = parseFloat(seller_payout) || 0;
    
    let warexRevenue = 0;
    let sellerPayout = 0;

    const oldDealRes = await pool.query('SELECT quantity, listing_id FROM deals WHERE id = $1', [id]);
    if (oldDealRes.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    const oldDeal = oldDealRes.rows[0];
    const oldQuantity = parseFloat(oldDeal.quantity) || 1;
    const newQuantity = parseFloat(quantity) || 1;
    const qtyDiff = newQuantity - oldQuantity;

    if (revenue_model === 'margin') {
      sellerPayout = inputSellerPayout;
      warexRevenue = finalPrice - sellerPayout;
    } else {
      warexRevenue = (finalPrice * commRate) / 100;
      sellerPayout = finalPrice - warexRevenue;
    }

    const result = await pool.query(
      `UPDATE deals SET 
        final_price = $1, 
        deal_value = $1,
        unit_price = $2,
        quantity = $3,
        commission_rate = $4, 
        seller_payout = $5,
        revenue_model = $6,
        commission_amount = $7,
        warex_revenue = $7,
        updated_at = NOW() 
      WHERE id = $8 RETURNING *`,
      [finalPrice, unit_price || 0, quantity || 1, commRate, sellerPayout, revenue_model || 'commission', warexRevenue, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    
    if (qtyDiff !== 0 && oldDeal.listing_id) {
      await pool.query(
        `UPDATE listings 
         SET quantity = GREATEST(quantity - $1, 0),
             is_hidden = CASE WHEN (quantity - $1) <= 0 THEN true ELSE is_hidden END,
             updated_at = NOW()
         WHERE id = $2`,
        [qtyDiff, oldDeal.listing_id]
      );
    }
    
    return res.status(200).json({
      message: 'Deal pricing updated',
      deal: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [ADMIN DEAL] Set price error:', error.message);
    return res.status(500).json({ message: 'Failed to update deal pricing' });
  }
};

const completeDeal = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const dealResult = await pool.query('SELECT * FROM deals WHERE id = $1', [id]);
    if (dealResult.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }

    const deal = dealResult.rows[0];

    if (deal.stage === 'completed') {
      return res.status(400).json({ message: 'Deal is already completed' });
    }

    let revenue = 0;
    let description = '';
    const { final_price, commission_rate, seller_payout, revenue_model } = deal;

    if (revenue_model === 'margin' || (!revenue_model && seller_payout && parseFloat(seller_payout) > 0)) {
      revenue = parseFloat(final_price) - parseFloat(seller_payout);
      description = `Margin on deal ${id} (Buyer: ${final_price}, Seller: ${seller_payout})`;
    } else if (revenue_model === 'commission' || (commission_rate && parseFloat(commission_rate) > 0)) {
      revenue = (parseFloat(final_price) * parseFloat(commission_rate)) / 100;
      description = `Commission on deal ${id}`;
    }

    await pool.query(
      `UPDATE deals SET 
        status = 'completed',
        stage = 'completed', 
        commission_amount = $1, 
        warex_revenue = $1, 
        closed_at = NOW(), 
        updated_at = NOW() 
       WHERE id = $2`,
      [revenue, id]
    );

    if (revenue > 0) {
      await pool.query(
        `INSERT INTO revenue_log (source_type, reference_id, amount, description, created_by)
         VALUES ($1, $2, $3, $4, $5)`,
        ['deal', id, revenue, description, req.user.id]
      );
    }

    return res.status(200).json({ 
      message: 'Deal completed successfully',
      revenue
    });
  } catch (error) {
    console.error('❌ [ADMIN DEAL] Complete deal error:', error.message);
    return res.status(500).json({ message: 'Failed to complete deal' });
  }
};

const adminDeleteDeal = async (req, res) => {
  const client = await pool.connect();
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { id } = req.params;

    const dealResult = await client.query('SELECT * FROM deals WHERE id = $1', [id]);
    if (dealResult.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }

    const deal = dealResult.rows[0];

    // Only allow deletion in initial/negotiation stages
    if (!['draft', 'proforma_generated', 'negotiation', 'finalized', 'initiated', 'nda_signed', 'cancelled'].includes(deal.stage)) {
      return res.status(400).json({ message: 'Cannot delete deal at this advanced stage' });
    }

    await client.query('BEGIN');

    // Revert inventory and wallet discount only if not already cancelled (prevents double restoration)
    if (deal.stage !== 'cancelled' && deal.status !== 'cancelled') {
      await releaseDealWalletDiscount(deal.buyer_id, deal.id, client);
      await restoreDealInventory(deal, client);
    }

    // 3. Delete Deal
    await client.query('DELETE FROM deals WHERE id = $1', [id]);
    await client.query('DELETE FROM commissions WHERE deal_id = $1', [id]);
    await client.query('DELETE FROM revenue_log WHERE source_type = $1 AND reference_id = $2', ['deal', id]);

    await client.query('COMMIT');
    console.log(`🗑️ [DEAL] Deal ${id} deleted, inventory and wallet reverted`);

    return res.status(200).json({ message: 'Deal cancelled and removed successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ [ADMIN DEAL] Delete error:', error.message);
    return res.status(500).json({ message: 'Failed to delete deal' });
  } finally {
    client.release();
  }
};

// ── NDA Controllers ─────────────────────────────────────────────────────────

const getNdaStatus = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, deal_id, nda_status, seller_nda_doc, buyer_nda_doc,
              s.full_name as seller_name, b.full_name as buyer_name
       FROM deals d
       LEFT JOIN users s ON d.seller_id = s.id
       LEFT JOIN users b ON d.buyer_id = b.id
       WHERE d.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Deal not found' });
    }
    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error('❌ [DEAL NDA] Get status error:', error.message);
    return res.status(500).json({ message: 'Failed to get NDA status' });
  }
};

const adminUploadNda = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }
    const { id } = req.params;
    const party = req.body.party;
    if (!['seller', 'buyer', 'agreement'].includes(party)) {
      return res.status(400).json({ message: 'party must be "seller", "buyer", or "agreement"' });
    }

    const { url } = await uploadFile({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      type: 'agreement',
      contextId: `nda/${id}`,
    });

    const column = (party === 'seller' || party === 'agreement') ? 'seller_nda_doc' : 'buyer_nda_doc';

    await pool.query(`UPDATE deals SET ${column} = $1, updated_at = NOW() WHERE id = $2`, [url, id]);

    const dealRes = await pool.query('SELECT seller_nda_doc, buyer_nda_doc FROM deals WHERE id = $1', [id]);
    const deal = dealRes.rows[0];
    let ndaStatus = 'pending';
    
    if (party === 'agreement' || (deal.seller_nda_doc && deal.buyer_nda_doc)) {
      ndaStatus = 'both_signed';
    } else if (deal.seller_nda_doc || deal.buyer_nda_doc) {
      ndaStatus = 'partial';
    }
    
    await pool.query('UPDATE deals SET nda_status = $1 WHERE id = $2', [ndaStatus, id]);

    console.log(`✅ [DEAL NDA] ${party} document uploaded for deal ${id} → status: ${ndaStatus}`);
    return res.status(200).json({
      message: `${party === 'agreement' ? 'Agreement' : party + ' NDA'} uploaded successfully`,
      url,
      nda_status: ndaStatus,
    });
  } catch (error) {
    console.error('❌ [DEAL NDA] Upload error:', error.message);
    return res.status(500).json({ message: error.message || 'Failed to upload NDA' });
  }
};

const adminRemoveNda = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    
    await pool.query(
      `UPDATE deals SET seller_nda_doc = NULL, buyer_nda_doc = NULL, nda_status = 'pending', updated_at = NOW() WHERE id = $1`, 
      [id]
    );

    return res.status(200).json({ message: 'Agreement removed successfully' });
  } catch (error) {
    console.error('❌ [NDA Remove] Error:', error);
    return res.status(500).json({ message: 'Failed to remove Agreement document' });
  }
};

const adminUploadDocuments = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }
    const { id } = req.params;
    
    const updates = {};
    const params = [];
    let queryStr = 'UPDATE deals SET updated_at = NOW()';
    let paramIdx = 1;

    if (req.files) {
      if (req.files.dispatch_doc && req.files.dispatch_doc[0]) {
        const file = req.files.dispatch_doc[0];
        const { url } = await uploadFile({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
          type: 'agreement',
          contextId: `dispatch-docs/${id}`
        });
        updates.dispatch_doc_url = url;
      }
      if (req.files.dispatch_photo && req.files.dispatch_photo[0]) {
        const file = req.files.dispatch_photo[0];
        const { url } = await uploadFile({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
          type: 'agreement',
          contextId: `dispatch-photos/${id}`
        });
        updates.dispatch_photo_url = url;
      }
      if (req.files.material_receipt && req.files.material_receipt[0]) {
        const file = req.files.material_receipt[0];
        const { url } = await uploadFile({
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
          type: 'agreement',
          contextId: `material-receipts/${id}`
        });
        updates.material_receipt_url = url;
      }
    }

    if (Object.keys(updates).length > 0) {
      for (const [key, value] of Object.entries(updates)) {
        queryStr += `, ${key} = $${paramIdx}`;
        params.push(value);
        paramIdx++;
      }
      queryStr += ` WHERE id = $${paramIdx}`;
      params.push(id);
      await pool.query(queryStr, params);
    }

    const dealCheck = await pool.query('SELECT * FROM deals WHERE id = $1', [id]);
    return res.status(200).json({ message: 'Documents uploaded successfully', deal: dealCheck.rows[0] });
  } catch (error) {
    console.error('❌ [DEAL UPLOAD] Error:', error);
    return res.status(500).json({ message: 'Failed to upload documents' });
  }
};

module.exports = {
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
  completeDeal,
  getNdaStatus,
  adminUploadNda,
  adminDeleteDeal,
  adminRemoveNda,
  adminUploadDocuments
};
