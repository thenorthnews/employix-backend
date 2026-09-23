// tenant middleware (placeholder)
module.exports = (req, res, next) => { req.tenant = null; next(); };
