const rateLimit = require('express-rate-limit');
const { badRequest } = require('../utils/response');
const { recordAuditEvent } = require('../common/audit/audit.service');

const rateLimitHandler = (actionType) => (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id || null;
  recordAuditEvent({
    correlationId,
    userId,
    action: actionType,
    status: 'FAILURE',
    endpoint: req.originalUrl,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    details: {
      error: 'Too many requests. Rate limit exceeded.',
      statusCode: 429,
    },
  });

  return res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
    correlationId,
  });
};

const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true, // `RateLimit-*` headers return karega
  legacyHeaders: false,
  handler: rateLimitHandler('GLOBAL_RATE_LIMIT_EXCEEDED'),
});
const kycLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?._id ? String(req.user._id) : req.ip;
  },
  handler: rateLimitHandler('KYC_RATE_LIMIT_EXCEEDED'),
});

module.exports = {
  globalApiLimiter,
  kycLimiter,
};