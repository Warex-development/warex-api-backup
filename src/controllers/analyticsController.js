const pool = require('../config/database');

/**
 * Get revenue analytics (Last 12 months)
 */
exports.getRevenueAnalytics = async (req, res) => {
  try {
    const query = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        source_type,
        SUM(amount) as revenue,
        COUNT(*) as count
      FROM revenue_log
      GROUP BY month, source_type
      ORDER BY month DESC, source_type ASC
      LIMIT 24
    `;
    const result = await pool.query(query);
    
    // Total revenue summary with deal models
    const summaryQuery = `
      SELECT 
        COALESCE(SUM(rl.amount), 0) as total,
        COALESCE(SUM(CASE WHEN rl.source_type = 'deal' THEN rl.amount ELSE 0 END), 0) as deals,
        COALESCE(SUM(CASE WHEN rl.source_type = 'deal' AND d.revenue_model = 'margin' THEN rl.amount ELSE 0 END), 0) as margin_revenue,
        COALESCE(SUM(CASE WHEN rl.source_type = 'deal' AND d.revenue_model = 'commission' THEN rl.amount ELSE 0 END), 0) as commission_revenue,
        COALESCE(SUM(CASE WHEN rl.source_type IN ('membership', 'membership_direct') THEN rl.amount ELSE 0 END), 0) as membership
      FROM revenue_log rl
      LEFT JOIN deals d ON rl.reference_id = d.id AND rl.source_type = 'deal'
    `;
    const summaryResult = await pool.query(summaryQuery);
    const summary = summaryResult.rows[0];

    // Fetch recent individual transactions
    const logsQuery = `
      SELECT 
        rl.*,
        u.vat_number as member_vat,
        u.full_name as member_name
      FROM revenue_log rl
      LEFT JOIN deals d ON rl.reference_id = d.id AND rl.source_type = 'deal'
      LEFT JOIN membership_requests mr ON rl.reference_id = mr.id AND rl.source_type = 'membership'
      LEFT JOIN users u ON (
        (rl.source_type = 'deal' AND d.buyer_id = u.id) OR 
        (rl.source_type = 'membership' AND mr.user_id = u.id) OR
        (rl.source_type = 'membership_direct' AND rl.reference_id = u.id)
      )
      ORDER BY rl.created_at DESC
      LIMIT 20
    `;
    const logsResult = await pool.query(logsQuery);

    return res.status(200).json({
      message: 'Revenue analytics retrieved',
      total_revenue: parseFloat(summary.total),
      deal_revenue: parseFloat(summary.deals),
      margin_revenue: parseFloat(summary.margin_revenue),
      commission_revenue: parseFloat(summary.commission_revenue),
      membership_revenue: parseFloat(summary.membership),
      breakdown: result.rows,
      recent_logs: logsResult.rows
    });
  } catch (error) {
    console.error('Analytics Error (Revenue):', error.message);
    return res.status(500).json({ error: 'Failed to retrieve revenue analytics' });
  }
};

/**
 * Get deals analytics
 */
exports.getDealsAnalytics = async (req, res) => {
  try {
    const { model } = req.query;
    const whereClause = model ? `WHERE d.revenue_model = '${model}'` : '';
    const whereClauseNoAlias = model ? `WHERE revenue_model = '${model}'` : '';

    const stageQuery = `
      SELECT 
        status as stage,
        COUNT(*) as count,
        SUM(deal_value) as total_value,
        SUM(warex_revenue) as total_revenue
      FROM deals d
      ${whereClause}
      GROUP BY status
    `;
    const summaryQuery = `
      SELECT 
        COUNT(*) as total_deals,
        COUNT(CASE WHEN status='completed' THEN 1 END) as completed,
        COUNT(CASE WHEN status != 'completed' THEN 1 END) as active_requests,
        COALESCE(SUM(deal_value), 0) as total_volume,
        COALESCE(SUM(warex_revenue), 0) as total_revenue,
        AVG(deal_value) as avg_deal_value
      FROM deals d
      ${whereClause}
    `;
    const categoryQuery = `
      SELECT 
        c.name as category,
        SUM(d.warex_revenue) as revenue,
        COUNT(d.id) as deals
      FROM deals d
      JOIN listings l ON d.listing_id = l.id
      JOIN categories c ON l.category_id = c.id
      ${whereClause}
      GROUP BY c.name
      ORDER BY revenue DESC
      LIMIT 5
    `;
    const sellerQuery = `
      SELECT 
        u.code as code,
        u.vat_number as vat,
        SUM(d.deal_value) as sales,
        SUM(d.warex_revenue) as revenue,
        COUNT(d.id) as deals
      FROM deals d
      JOIN users u ON d.seller_id = u.id
      ${whereClause}
      GROUP BY u.code, u.vat_number
      ORDER BY revenue DESC
      LIMIT 5
    `;
    
    const stageResult = await pool.query(stageQuery);
    const summaryResult = await pool.query(summaryQuery);
    const categoryResult = await pool.query(categoryQuery);
    const sellerResult = await pool.query(sellerQuery);
    
    const monthlyDealsQuery = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as count
      FROM deals d
      ${whereClause}
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `;
    const monthlyDealsResult = await pool.query(monthlyDealsQuery);
    
    return res.status(200).json({
      message: 'Deals analytics retrieved',
      stages: stageResult.rows,
      summary: summaryResult.rows[0],
      categories: categoryResult.rows,
      sellers: sellerResult.rows,
      monthly_deals: monthlyDealsResult.rows
    });
  } catch (error) {
    console.error('Analytics Error (Deals):', error.message);
    return res.status(500).json({ error: 'Failed to retrieve deals analytics' });
  }
};

/**
 * Get users analytics
 */
exports.getUsersAnalytics = async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total_users,
        COUNT(CASE WHEN status='active' OR status='approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status='pending' THEN 1 END) as pending,
        COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as new_this_month
      FROM users
    `;
    const result = await pool.query(query);
    
    return res.status(200).json({
      message: 'Users analytics retrieved',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics Error (Users):', error.message);
    return res.status(500).json({ error: 'Failed to retrieve users analytics' });
  }
};

/**
 * Get inventory analytics
 */
exports.getInventoryAnalytics = async (req, res) => {
  try {
    const query = `
      SELECT 
        COUNT(*) as total_listings,
        COUNT(CASE WHEN status='approved' THEN 1 END) as approved,
        COUNT(CASE WHEN status IN ('pending', 'pending_review') THEN 1 END) as pending,
        COUNT(CASE WHEN status='sold' THEN 1 END) as sold
      FROM listings
    `;
    const result = await pool.query(query);
    
    return res.status(200).json({
      message: 'Inventory analytics retrieved',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Analytics Error (Inventory):', error.message);
    return res.status(500).json({ error: 'Failed to retrieve inventory analytics' });
  }
};
