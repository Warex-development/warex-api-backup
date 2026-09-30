const pool = require('../config/database');

// In-memory cache with ~5-minute TTL
let statsCache = null;
let statsCacheTime = 0;
let industryCache = null;
let industryCacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * GET /api/stats/homepage
 * Public endpoint — no auth required.
 * Returns: { activeMembers, premiumMembers, partsListed, dealsThisMonth }
 */
exports.getHomepageStats = async (req, res) => {
  try {
    const now = Date.now();

    // Return cached result if still fresh
    if (statsCache && now - statsCacheTime < CACHE_TTL_MS) {
      return res.status(200).json(statsCache);
    }

    // Active members + premium members
    // Schema: users.status ('pending'|'active'|'approved'), users.plan ('Free'|'Standard'|'Professional'|'Enterprise')
    // Premium = any paid plan (Standard, Professional, Enterprise) — default is 'Standard'
    const membersResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('active', 'approved'))                                  AS active_members,
        COUNT(*) FILTER (WHERE status IN ('active', 'approved') AND LOWER(plan) != 'free')       AS premium_members
      FROM users
      WHERE role = 'member'
    `);

    // Approved (live) listings count and total worth
    // Schema: listings.status ('pending'|'pending_review'|'approved'|'rejected')
    const listingsResult = await pool.query(`
      SELECT 
        COUNT(*) AS parts_listed,
        COALESCE(SUM(
          CASE 
            WHEN bid_price IS NOT NULL AND bid_price > 0 THEN bid_price * COALESCE(quantity, 1)
            WHEN seller_bid_price IS NOT NULL AND seller_bid_price > 0 THEN seller_bid_price * COALESCE(quantity, 1)
            ELSE 0 
          END
        ), 0) AS total_equipment_worth
      FROM listings
      WHERE status = 'approved'
    `);

    // Total Deals created all time
    const dealsResult = await pool.query(`
      SELECT COUNT(*) AS total_deals FROM deals
    `);

    const row = membersResult.rows[0];
    const listingRow = listingsResult.rows[0] || {};
    const stats = {
      activeMembers:       parseInt(row.active_members)  || 0,
      premiumMembers:      parseInt(row.premium_members) || 0,
      partsListed:         parseInt(listingRow.parts_listed)  || 0,
      totalEquipmentWorth: parseFloat(listingRow.total_equipment_worth) || 0,
      totalDeals:          parseInt(dealsResult.rows[0]?.total_deals) || 0,
    };

    // Update cache
    statsCache = stats;
    statsCacheTime = now;

    return res.status(200).json(stats);
  } catch (error) {
    console.error('❌ [PUBLIC STATS] Homepage stats error:', error.message);
    return res.status(500).json({ error: 'Failed to retrieve homepage stats' });
  }
};

/**
 * GET /api/listings/count-by-industry
 * Public endpoint — no auth required.
 * Returns: { beverages, brewery, dairy, steel, hydro, plywood, hospitality, construction, ... }
 *
 * Counts approved listings by matching a set of known industry keywords
 * against listing category names or description text.
 */
exports.getCountByIndustry = async (req, res) => {
  try {
    const now = Date.now();

    if (industryCache && now - industryCacheTime < CACHE_TTL_MS) {
      return res.status(200).json(industryCache);
    }

    // Map industry keys → keywords to match in category names or listing descriptions
    const INDUSTRY_MAP = {
      beverages:    ['beverage', 'bottling', 'fermentation', 'filtration'],
      brewery:      ['brewery', 'brewing', 'fermenter', 'fermenter', 'brew'],
      dairy:        ['dairy', 'pasteuriz', 'separator', 'filling'],
      steel:        ['steel', 'rolling mill', 'furnace', 'crane'],
      hydro:        ['hydro', 'turbine', 'generator', 'power'],
      plywood:      ['plywood', 'veneer', 'sorter', 'stacker'],
      hospitality:  ['hospitality', 'hvac', 'laundry', 'kitchen'],
      construction: ['construction', 'concrete', 'excavator'],
      agroprocessing: ['agro', 'thresher', 'seed'],
      printing:     ['print', 'packaging', 'die-cut', 'sealer'],
      chemicals:    ['chemical', 'pharma', 'reactor'],
      logistics:    ['logistic', 'conveyor', 'forklift', 'sorting'],
    };

    // Fetch all approved listing category names and descriptions in one query
    const result = await pool.query(`
      SELECT
        l.description,
        c.name AS category_name
      FROM listings l
      LEFT JOIN categories c ON l.category_id = c.id
      WHERE l.status = 'approved'
    `);

    const rows = result.rows;

    // Count per industry by keyword matching
    const counts = {};
    for (const [industry, keywords] of Object.entries(INDUSTRY_MAP)) {
      counts[industry] = rows.filter(row => {
        const haystack = `${row.category_name || ''} ${row.description || ''}`.toLowerCase();
        return keywords.some(kw => haystack.includes(kw));
      }).length;
    }

    industryCache = counts;
    industryCacheTime = now;

    return res.status(200).json(counts);
  } catch (error) {
    console.error('❌ [PUBLIC STATS] Industry count error:', error.message);
    return res.status(500).json({ error: 'Failed to retrieve industry counts' });
  }
};
