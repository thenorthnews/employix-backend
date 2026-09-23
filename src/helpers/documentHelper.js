const { v4: uuidv4 } = require('uuid');

/**
 * Standardized PII Masking
 */
const maskDocumentNumber = (docNum) => {
  if (!docNum) return null;
  const cleaned = String(docNum).replace(/[\s-]+/g, '').toUpperCase();

  // PAN Masking: ABCDE1234F -> ABCXXXXXXF
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  if (panRegex.test(cleaned)) {
    return `${cleaned.slice(0, 3)}XXXXXX${cleaned.slice(-1)}`;
  }

  // 12-digit format (e.g. Aadhaar): Mask first 8 digits -> XXXXXXXX1234
  if (cleaned.length === 12) {
    return 'X'.repeat(8) + cleaned.slice(-4);
  }

  // Generic fallback: Keep last 4 digits
  if (cleaned.length >= 4) {
    return 'X'.repeat(cleaned.length - 4) + cleaned.slice(-4);
  }

  return 'X'.repeat(cleaned.length || 8);
};

const maskVoterId = (id) => {
  if (!id || typeof id !== 'string') return null;
  const clean = id.replace(/[\s-]+/g, '').toUpperCase();
  if (clean.length <= 4) return clean;
  return 'X'.repeat(clean.length - 4) + clean.slice(-4);
};

/**
 * Address Parser & Formatter
 */
const extractFormattedAddress = (addressObj) => {
  if (!addressObj) return null;
  if (typeof addressObj === 'string') return addressObj.trim();

  if (addressObj.combinedAddress) {
    return addressObj.combinedAddress.trim();
  }

  const parts = [
    addressObj.houseNumber || addressObj.building,
    addressObj.street || addressObj.streetAddress,
    addressObj.locality || addressObj.area,
    addressObj.landmark,
    addressObj.city || addressObj.district,
    addressObj.state,
    addressObj.pincode || addressObj.postalCode,
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : null;
};

/**
 * Date Parser
 */
const parseDocumentDob = (dobString) => {
  if (!dobString) return null;

  const parts = String(dobString).trim().split(/[-/]/);
  if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
    const [day, month, year] = parts;
    const parsed = new Date(`${year}-${month}-${day}`);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(dobString);
  return isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Gender Standardizer
 */
const standardizeGender = (genderStr) => {
  if (!genderStr) return null;
  const lower = String(genderStr).trim().toLowerCase();
  if (lower.startsWith('m')) return 'male';
  if (lower.startsWith('f')) return 'female';
  return 'other';
};

const generateSafeGroupId = () => `grp_${uuidv4().replace(/-/g, '').slice(0, 20)}`;

const getGatewayHeaders = () => ({
  'x-client-id': process.env.SETU_CLIENT_ID,
  'x-client-secret': process.env.SETU_CLIENT_SECRET,
  'x-product-instance-id': process.env.SETU_VOTER_INSTANCE_ID || process.env.SETU_PRODUCT_INSTANCE_ID,
  'Content-Type': 'application/json',
});
const resolveErrorInfo = (err, defaultMessage) => {
  const statusCode = err.statusCode || err.response?.status || 500;
  const rawMessage =
    err.response?.data?.message ||
    (typeof err.response?.data?.error === 'string' ? err.response.data.error : null) ||
    err.response?.data?.error?.message ||
    err.response?.data?.error?.detail ||
    err.response?.data?.detail ||
    err.response?.data?.description ||
    err.response?.data?.error_description ||
    (Array.isArray(err.response?.data?.errors) && (err.response.data.errors[0]?.message || err.response.data.errors[0])) ||
    (typeof err.response?.data === 'string' && err.response.data.length < 300 ? err.response.data : null) ||
    err.message;

  const message =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0
      ? rawMessage
      : defaultMessage;

  return { statusCode, message };
};
const calculateEmployixScore = ({ aadhaarDone, voterDone, dlDone, empDone, eduDone }) => {
  return parseFloat(
    (
      (aadhaarDone ? 20 : 0) +
      (voterDone ? 20 : 0) +
      (dlDone ? 5 : 0) +
      (empDone ? 35 : 0) +
      (eduDone ? 20 : 0)
    ).toFixed(1)
  );
};

const calculateKycStatus = ({ aadhaarDone, voterDone, dlDone, empDone, eduDone }) => {
  const allDone = Boolean(aadhaarDone && voterDone && dlDone && empDone && eduDone);
  if (allDone) return 7;
  let steps = 1; // Step 1: Candidate Profile Details
  if (aadhaarDone) steps++;
  if (empDone) steps++;
  if (voterDone) steps++;
  if (dlDone) steps++;
  if (eduDone) steps++;
  return Math.min(6, steps);
};
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = {
  maskDocumentNumber,
  maskVoterId,
  extractFormattedAddress,
  parseDocumentDob,
  standardizeGender,
  generateSafeGroupId,
  getGatewayHeaders,
  resolveErrorInfo,
  calculateEmployixScore,
  calculateKycStatus,
  hashToken
};