const { verifyToken } = require('../utils/jwt');
const User = require('../common/users/user.model');
const { unauthorized } = require('../utils/response');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return unauthorized(res, 'No token provided');
  }
  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.id);

    if (!user) {
      return unauthorized(res, 'Invalid token');
    }
    req.user = user;
    next();
  } catch (err) {
    return unauthorized(res, 'Invalid token');
  }
}

module.exports = { requireAuth };