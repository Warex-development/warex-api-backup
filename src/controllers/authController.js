const bcrypt = require('bcrypt');
const crypto = require('crypto');
const pool = require('../config/database');
const { generateToken } = require('../middleware/auth');
const { sendNewRegistrationAlert, sendPasswordChangedEmail, sendForgotPasswordEmail, sendAdminForgotPasswordAlert } = require('../services/emailService');

// Function to generate unique code
const generateUniqueCode = async () => {
  let code;
  let isUnique = false;

  while (!isUnique) {
    code = 'WX-' + Math.floor(1000 + Math.random() * 9000);
    const result = await pool.query('SELECT id FROM users WHERE code = $1', [code]);
    isUnique = result.rows.length === 0;
  }

  return code;
};

// Function to generate 4-char alphanumeric temp password
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(4))
    .map(b => chars[b % chars.length])
    .join('');
};

const register = async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      company_name,
      vat_number,
      email,
      country,
      mobile,
      industry,
      industry_other,
      agreed_nda,
      agreed_terms
    } = req.body;

    console.log(`📝 [REGISTER] Attempting registration for: ${email}`);

    // Validation: Check if agreements are accepted
    if (!agreed_nda) {
      console.log(`⚠️  [REGISTER] NDA not agreed by: ${email}`);
      return res.status(400).json({ message: 'Please agree to NDA' });
    }

    if (!agreed_terms) {
      console.log(`⚠️  [REGISTER] Terms not agreed by: ${email}`);
      return res.status(400).json({ message: 'Please agree to Terms' });
    }

    // Check if VAT number already exists
    if (vat_number) {
      const vatCheck = await pool.query(
        'SELECT id FROM users WHERE vat_number = $1',
        [vat_number]
      );
      if (vatCheck.rows.length > 0) {
        console.log(`⚠️  [REGISTER] VAT number already exists: ${vat_number}`);
        return res.status(400).json({
          message: 'This VAT number is already registered'
        });
      }
    }

    // Generate full_name
    const full_name = `${first_name} ${last_name}`.trim();

    // Generate avatar (first letter of first_name + first letter of last_name, uppercase)
    const avatar = `${(first_name[0] || '').toUpperCase()}${(last_name[0] || '').toUpperCase()}`;

    // Generate unique code
    const code = await generateUniqueCode();
    const party_code = code;

    // Generate auto-temp password (4 char alphanumeric)
    const tempPassword = generateTempPassword();

    // Hash password
    const saltRounds = 10;
    const password_hash = await bcrypt.hash(tempPassword, saltRounds);
    console.log(`🔐 [REGISTER] Temp password generated: ${tempPassword}`);

    // Insert user into database
    const result = await pool.query(
      `INSERT INTO users (
        first_name, last_name, full_name, email, password_hash, company_name,
        vat_number, country, mobile, industry, industry_other, code, party_code, avatar,
        role, status, plan, agreed_nda, agreed_terms, temp_password
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) 
      RETURNING id, full_name, email, code, status`,
      [
        first_name,
        last_name,
        full_name,
        email,
        password_hash,
        company_name,
        vat_number,
        country,
        mobile,
        industry,
        industry_other,
        code,
        party_code,
        avatar,
        'member',
        'pending',
        'Free',
        agreed_nda,
        agreed_terms,
        tempPassword
      ]
    );

    const user = result.rows[0];

    console.log(`✅ [REGISTER] User registered successfully (ID: ${user.id}, Email: ${email}, Code: ${code}, Status: pending)`);

    // Notify via Email
    await sendNewRegistrationAlert({
      ...user,
      first_name,
      last_name,
      company_name,
      vat_number,
      industry,
      industry_other
    });

    // Notify admins
    const { notifyAdmins } = require('../services/notificationService');
    await notifyAdmins(
      'New Registration 👤',
      `New member application from ${company_name} (${full_name}) is awaiting verification.`,
      'system',
      '/admin/registrations'
    );

    // Generate token
    const token = generateToken(user);

    return res.status(201).json({
      message: 'Application submitted. Our team will verify within 24 hours.',
      token, // Return token for immediate VAT upload
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        code: user.code,
        status: user.status
      }
    });
  } catch (error) {
    console.error('❌ [REGISTER] Error:', error.message);
    return res.status(500).json({ message: 'Registration failed' });
  }
};

const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    const cleanIdentifier = identifier ? identifier.trim() : '';

    // Extract VAT from identifier (e.g. W-123456789)
    let vatNumber = cleanIdentifier;
    if (cleanIdentifier.toLowerCase().startsWith('w-')) {
      vatNumber = cleanIdentifier.substring(2);
    }

    // Find user by vat_number, email, or code
    const result = await pool.query(
      'SELECT * FROM users WHERE vat_number = $1 OR email = $2 OR code = $1',
      [vatNumber, cleanIdentifier.toLowerCase()]
    );

    if (result.rows.length === 0) {
      console.log(`⚠️  [LOGIN] User not found: ${identifier}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Compare password with hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      console.log(`⚠️  [LOGIN] Invalid password for: ${identifier}`);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check user status
    if (user.status === 'pending') {
      console.log(`⚠️  [LOGIN] Account pending approval: ${identifier}`);
      return res.status(403).json({
        message: 'Your account is awaiting admin approval.'
      });
    }

    if (user.status === 'rejected') {
      console.log(`⚠️  [LOGIN] Account rejected: ${identifier}`);
      return res.status(403).json({
        message: 'Your application was not approved. Contact support@warexhub.com'
      });
    }

    if (user.status === 'suspended') {
      console.log(`⚠️  [LOGIN] Account suspended: ${identifier}`);
      return res.status(403).json({
        message: 'Your account has been suspended. Contact support.'
      });
    }

    if (user.status === 'deleted') {
      console.log(`⚠️  [LOGIN] Account deleted: ${identifier}`);
      return res.status(403).json({
        message: 'Your account has been deactivated. Contact support.'
      });
    }

    // Generate token
    const token = generateToken(user);

    console.log(`✅ [LOGIN] User logged in successfully (ID: ${user.id}, Identifier: ${identifier})`);

    return res.status(200).json({
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        role: user.role,
        member_mode: user.mode,
        company_name: user.company_name,
        mobile: user.mobile,
        vat_number: user.vat_number,
        code: user.code,
        plan: user.plan,
        plan_cycle: user.plan_cycle,
        plan_expiry: user.plan_expiry,
        avatar: user.avatar,
        industry: user.industry,
        country: user.country,
        address: user.address
      }
    });
  } catch (error) {
    console.error('❌ [LOGIN] Error:', error.message);
    return res.status(500).json({ message: 'Login failed' });
  }
};

const adminLogin = async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = email ? email.trim() : '';

  try {
    console.log(`🔓 [ADMIN LOGIN] Login attempt for: ${email}`);

    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [cleanEmail.toLowerCase()]
    );

    const user = result.rows[0];

    if (!user) {
      console.log(`⚠️  [ADMIN LOGIN] User not found: ${email}`);
      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      console.log(`⚠️  [ADMIN LOGIN] Invalid password for: ${email}`);
      return res.status(401).json({
        message: 'Invalid credentials'
      });
    }

    if (user.role !== 'admin' && user.role !== 'support' && user.role !== 'reviewer') {
      console.log(`⚠️  [ADMIN LOGIN] Non-admin access attempt: ${email}`);
      return res.status(403).json({
        message: 'You are not an admin.',
        code: 'NOT_ADMIN'
      });
    }

    const token = generateToken(user);
    console.log(`✅ [ADMIN LOGIN] User logged in successfully (ID: ${user.id}, Email: ${email})`);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: user.full_name
      }
    });

  } catch (error) {
    console.error('❌ [ADMIN LOGIN] Error:', error.message);
    const isProd = process.env.NODE_ENV === 'production';
    return res.status(500).json({ message: isProd ? 'Internal server error' : error.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { login_id } = req.body;
    const cleanId = login_id ? login_id.trim() : '';
    let vatNumber = cleanId;
    if (cleanId.toLowerCase().startsWith('w-')) {
      vatNumber = cleanId.substring(2);
    }

    console.log(`🔑 [FORGOT PASSWORD] Request for VAT: ${vatNumber}`);

    const userResult = await pool.query('SELECT id, email, vat_number FROM users WHERE vat_number = $1', [vatNumber]);
    if (userResult.rows.length === 0) {
      console.log(`⚠️  [FORGOT PASSWORD] User not found: ${vatNumber}`);
      return res.status(404).json({ message: 'User not found' });
    }
    const user = userResult.rows[0];

    const tempPassword = generateTempPassword();
    const password_hash = await bcrypt.hash(tempPassword, 10);

    await pool.query(
      'UPDATE users SET password_hash = $1, temp_password = $2 WHERE id = $3',
      [password_hash, tempPassword, user.id]
    );

    // Create notification for admin
    await pool.query(
      `INSERT INTO notifications (user_id, title, message, type) 
       SELECT id, $1, $2, $3 FROM users WHERE role = 'admin'`,
      ['Password Reset Request', `Member W-${user.vat_number} requested password reset. New temp password: ${tempPassword}`, 'system']
    );

    console.log(`✅ [FORGOT PASSWORD] Reset request successful for: ${user.email}`);
    
    // Notify user that a reset occurred and send temp password
    const fullUser = (await pool.query('SELECT * FROM users WHERE id = $1', [user.id])).rows[0];
    await sendForgotPasswordEmail(fullUser, tempPassword);
    
    // Notify admin via email
    await sendAdminForgotPasswordAlert(fullUser, tempPassword);

    return res.json({ message: 'A temporary password has been sent to your email.' });
  } catch (error) {
    console.error('❌ [FORGOT PASSWORD] Error:', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    console.log(`🔄 [RESET PASSWORD] Request for user ID: ${userId}`);

    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = userResult.rows[0];

    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      console.log(`⚠️  [RESET PASSWORD] Current password incorrect for ID: ${userId}`);
      return res.status(400).json({ message: 'Current password incorrect' });
    }

    const hashedNew = await bcrypt.hash(newPassword, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, temp_password = NULL WHERE id = $2',
      [hashedNew, userId]
    );

    console.log(`✅ [RESET PASSWORD] Success for user ID: ${userId}`);

    // Notify user of successful change
    const fullUser = (await pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
    await sendPasswordChangedEmail(fullUser);

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('❌ [RESET PASSWORD] Error:', error.message);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const quickRegister = async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const { full_name, email } = req.body;
    if (!email || !full_name) {
      return res.status(400).json({ message: 'Name and email are required' });
    }

    // Check if user already exists
    const checkUser = await pool.query('SELECT id, full_name, email, code FROM users WHERE email = $1', [email.toLowerCase()]);
    if (checkUser.rows.length > 0) {
      return res.status(200).json({ 
        message: 'User already exists', 
        user: checkUser.rows[0] 
      });
    }

    // Create new shadow user
    const first_name = full_name.split(' ')[0] || 'Guest';
    const last_name = full_name.split(' ').slice(1).join(' ') || '';
    const avatar = `${first_name[0] || 'G'}${(last_name[0] || '').toUpperCase()}`;
    const code = await generateUniqueCode();
    const tempPassword = generateTempPassword();
    const password_hash = await bcrypt.hash(tempPassword, 10);

    const result = await pool.query(
      `INSERT INTO users (
        first_name, last_name, full_name, email, password_hash, 
        code, party_code, avatar, role, status, plan, 
        agreed_nda, agreed_terms, temp_password
      ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13) 
      RETURNING id, full_name, email, code, status`,
      [first_name, last_name, full_name, email.toLowerCase(), password_hash, code, avatar, 'member', 'approved', 'Free', true, true, tempPassword]
    );

    console.log(`✅ [QUICK REGISTER] Shadow user created: ${email}`);

    return res.status(201).json({
      message: 'Guest registered successfully',
      user: result.rows[0],
      tempPassword
    });
  } catch (error) {
    console.error('❌ [QUICK REGISTER] Error:', error.message);
    return res.status(500).json({ message: 'Quick registration failed' });
  }
};

module.exports = {
  register,
  login,
  adminLogin,
  forgotPassword,
  resetPassword,
  quickRegister
};
