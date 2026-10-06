const { verifyToken } = require('../utils/jwt');
const User = require('../common/users/user.model');
const { unauthorized } = require('../utils/response');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[AUTH DEBUG] ❌ No Authorization Bearer header found on:', req.method, req.originalUrl);
    return unauthorized(res, 'No token provided');
  }
  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.id);

    if (!user || user.isDeleted) {
      console.log('[AUTH DEBUG] ❌ User not found or deleted for ID:', payload?.id);
      return unauthorized(res, 'User not found or account has been deleted');
    }
    req.user = user;
    next();
  } catch (err) {
    console.log('[AUTH DEBUG] ❌ JWT Token verification failed:', err.message, 'on', req.method, req.originalUrl);
    return unauthorized(res, `Invalid token: ${err.message}`);
  }
}

module.exports = { requireAuth };