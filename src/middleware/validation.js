const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  // At least 8 characters
  return password && password.length >= 8;
};

const validateRegisterInput = (req, res, next) => {
  const {
    first_name,
    last_name,
    company_name,
    vat_number,
    email,
    country,
    mobile,
    industry,
    password,
    agreed_nda,
    agreed_terms
  } = req.body;

  if (!first_name || first_name.trim().length === 0) {
    return res.status(400).json({ message: 'First name is required' });
  }

  if (!last_name || last_name.trim().length === 0) {
    return res.status(400).json({ message: 'Last name is required' });
  }

  if (!email || !validateEmail(email)) {
    return res.status(400).json({ message: 'Valid email is required' });
  }



  if (!company_name || company_name.trim().length === 0) {
    return res.status(400).json({ message: 'Company name is required' });
  }

  if (!vat_number || vat_number.trim().length === 0) {
    return res.status(400).json({ message: 'VAT number is required' });
  }

  if (!country || country.trim().length === 0) {
    return res.status(400).json({ message: 'Country is required' });
  }

  if (!mobile || mobile.trim().length === 0) {
    return res.status(400).json({ message: 'Mobile number is required' });
  }

  if (!industry || industry.trim().length === 0) {
    return res.status(400).json({ message: 'Industry is required' });
  }

  if (agreed_nda !== true) {
    return res.status(400).json({ message: 'Please agree to NDA' });
  }

  if (agreed_terms !== true) {
    return res.status(400).json({ message: 'Please agree to Terms' });
  }

  next();
};

const validateLoginInput = (req, res, next) => {
  const { identifier, password } = req.body;

  if (!identifier || identifier.trim().length === 0) {
    return res.status(400).json({ message: 'VAT number is required' });
  }

  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  next();
};

module.exports = {
  validateRegisterInput,
  validateLoginInput,
  validateEmail,
  validatePassword
};
