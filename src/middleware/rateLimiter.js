const rateLimit = require('express-rate-limit');

// Rate limiter for authentication endpoints (login, forgot-password)
// Max 5 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many login attempts from this IP. Please try again after 15 minutes.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Rate limiter for user registration
// Max 10 registrations per hour per IP
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many accounts created from this IP. Please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// Rate limiter for public contact/leads form submissions
// Max 10 submissions per hour per IP
const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many submissions from this IP. Please try again after an hour.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

// General API rate limiter to prevent abuse
// Max 500 requests per 15 minutes per IP
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: 'Too many requests. Please slow down.',
    code: 'RATE_LIMIT_EXCEEDED'
  }
});

module.exports = {
  authLimiter,
  registerLimiter,
  publicFormLimiter,
  apiLimiter
};
