const AuditLog = require('../audit/auditLog');
const logger = require('../../utils/logger');
const recordAuditEvent = ({
  correlationId,
  userId = null,
  action,
  status,
  endpoint,
  ipAddress = null,
  userAgent = null,
  details = {},
}) => {
  AuditLog.create({
    correlationId,
    userId,
    action,
    status,
    endpoint,
    ipAddress,
    userAgent,
    details,
  }).catch((err) => {
    logger.error('Failed to write audit log to database', {
      error: err.message,
      correlationId,
      action,
    });
  });
};

module.exports = { recordAuditEvent };