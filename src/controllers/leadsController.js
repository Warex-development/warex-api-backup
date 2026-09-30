const pool = require('../config/database');
const { sendGuestThankYouEmail, sendNewLeadAlert, sendNotifyMeAlert } = require('../services/emailService');

const createGuestLead = async (req, res) => {
  try {
    const { name, phone, email, message, notes, listing_id, isNotifyMe, company, quantity } = req.body;
    const actualMessage = message || notes || '';

    if (!name || !email) {
      return res.status(400).json({ message: 'Name and email are required.' });
    }

    const result = await pool.query(
      `INSERT INTO guest_leads (name, phone, email, message, listing_id) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, phone, email, actualMessage, listing_id]
    );

    // Fetch listing name if listing_id is present
    let listingName = 'an item on WareXhub';
    if (listing_id) {
      const listingRes = await pool.query('SELECT name FROM listings WHERE id = $1', [listing_id]);
      if (listingRes.rows.length > 0) {
        listingName = listingRes.rows[0].name;
      }
    }

    // Send thank you email to guest
    await sendGuestThankYouEmail(result.rows[0], listingName);

    if (isNotifyMe && listing_id) {
      try {
        const listingResult = await pool.query('SELECT * FROM listings WHERE id = $1', [listing_id]);
        if (listingResult.rows.length > 0) {
          const listing = listingResult.rows[0];
          const sellerResult = await pool.query('SELECT * FROM users WHERE id = $1', [listing.seller_id]);
          const seller = sellerResult.rows[0] || {};
          
          await sendNotifyMeAlert({
            name,
            email,
            phone,
            company,
            quantity: quantity || 1
          }, listing, seller);
        }
      } catch (err) {
        console.error('❌ [GUEST LEAD] Failed to send NotifyMe alert:', err.message);
      }
    } else {
      // Alert admin about the new lead normally
      await sendNewLeadAlert(result.rows[0], listingName);
    }

    return res.status(201).json({
      message: 'Interest submitted successfully',
      lead: result.rows[0]
    });
  } catch (error) {
    console.error('❌ [GUEST LEAD] Error creating guest lead:', error.message);
    return res.status(500).json({ message: 'Failed to submit interest' });
  }
};

const getAllLeads = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        gl.*,
        l.name AS listing_name
      FROM guest_leads gl
      LEFT JOIN listings l ON gl.listing_id = l.id
      ORDER BY gl.created_at DESC
    `);
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('❌ [GUEST LEAD] Error fetching leads:', error.message);
    return res.status(500).json({ message: 'Failed to fetch leads' });
  }
};

const updateLeadStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['new', 'contacted', 'closed'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const result = await pool.query(
      'UPDATE guest_leads SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Lead not found' });
    return res.status(200).json({ message: 'Status updated', lead: result.rows[0] });
  } catch (error) {
    console.error('❌ [GUEST LEAD] Error updating lead:', error.message);
    return res.status(500).json({ message: 'Failed to update lead' });
  }
};

module.exports = {
  createGuestLead,
  getAllLeads,
  updateLeadStatus
};
