const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    mode: user.mode,
    full_name: user.full_name
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: '7d'
  });

  return token;
};

const pool = require('../config/database');

const verifyToken = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;

  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user is suspended or deleted in DB
    const userResult = await pool.query('SELECT status FROM users WHERE id = $1', [decoded.id]);
    
    if (userResult.rows.length === 0) {
      return res.status(401).json({ message: 'User no longer exists', code: 'USER_DELETED' });
    }

    const userStatus = userResult.rows[0].status;
    if (userStatus === 'suspended') {
      return res.status(401).json({ message: 'Your account has been suspended. Please contact support.', code: 'USER_SUSPENDED' });
    }
    if (userStatus === 'deleted') {
      return res.status(401).json({ message: 'Your account has been deleted.', code: 'USER_DELETED' });
    }

    req.user = decoded;

    // --- DEMO MODE INTERCEPT FOR SALES TEAM ---
    if (req.user.role === 'sales') {
      const isWriteMethod = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
      if (isWriteMethod) {
        return res.status(200).json({
          message: 'Sales Demo Mode: Action simulated successfully.',
          success: true,
          id: 'demo-id',
          url: 'https://demo.url',
          deal: { deal_id: 'DEMO-1234' },
          listing: { id: 'demo-listing-id', request_id: 'DEMO-REQ-1' },
          request: { id: 'demo-request-id', request_id: 'DEMO-REQ-2' }
        });
      }
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid or expired token', code: 'TOKEN_INVALID' });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'admin' || req.user.role === 'reviewer')) {
    next();
  } else {
    res.status(403).json({ message: 'Require Admin Role' });
  }
};

module.exports = {
  generateToken,
  verifyToken,
  isAdmin
};
