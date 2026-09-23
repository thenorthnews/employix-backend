const { v4: uuidv4 } = require('uuid');

const correlationMiddleware = (req, res, next) => {
  const incomingId = req.headers['x-correlation-id'];
  const correlationId = incomingId || `corr_${uuidv4()}`;
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  next();
};

module.exports = correlationMiddleware;