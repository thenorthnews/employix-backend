// error handler placeholder
module.exports = (err, req, res, next) => { res.status(500).json({ error: err.message }); };
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || 500;
  const { serverError } = require('../helpers/response');
  if (status >= 500) return serverError(res, err);
  // for other statuses, return structured JSON
  return res.status(status).json({ success: false, status, message: err.message });
}

module.exports = { errorHandler };
