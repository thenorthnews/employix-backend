const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET ;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const crypto = require("crypto");

 const generateToken = (payload) => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};
 const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

const generateResetToken = () => {
  return crypto.randomBytes(32).toString("hex");
};

const hashResetToken = (token) => {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
};

const generateResetTokenExpiry = (minutes = 15) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};

const generateResetPasswordUrl = (token) => {
  return `${process.env.FRONTEND_URL}/reset-password/${token}`;
};



module.exports = { generateToken, verifyToken,generateResetToken,
  hashResetToken,
  generateResetTokenExpiry,
  generateResetPasswordUrl };