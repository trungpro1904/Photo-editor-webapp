const authStore = require('../utils/authStore');

function parseToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;
  return authHeader.slice(7).trim();
}

async function optionalAuth(req, res, next) {
  try {
    const token = parseToken(req);
    if (!token) {
      req.user = null;
      return next();
    }

    const session = await authStore.getSession(token);
    req.user = session ? session.user : null;
    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireAuth(req, res, next) {
  try {
    const token = parseToken(req);
    if (!token) {
      return res.status(401).json({ error: 'Thiếu token đăng nhập' });
    }

    const session = await authStore.getSession(token);
    if (!session || !session.user) {
      return res.status(401).json({ error: 'Token không hợp lệ hoặc đã hết hạn' });
    }

    req.user = session.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  optionalAuth,
  requireAuth
};
