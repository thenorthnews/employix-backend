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

  let message =
    typeof rawMessage === 'string' && rawMessage.trim().length > 0
      ? rawMessage
      : defaultMessage;

  const lowerMsg = String(message).toLowerCase();
  const lowerDef = String(defaultMessage || '').toLowerCase();
  if (
    lowerMsg.includes('non compliant') ||
    lowerMsg.includes('quality standard') ||
    lowerMsg.includes('not compliant') ||
    lowerMsg.includes('document_quality')
  ) {
    if (lowerDef.includes('driving license') || lowerDef.includes('dl')) {
      if (lowerMsg.includes('front') || lowerMsg.includes('documentfront')) {
        message = 'Please upload a valid Driving License (Front side). Only Driving License is accepted.';
      } else if (lowerMsg.includes('back') || lowerMsg.includes('documentback')) {
        message = 'Please upload a valid Driving License (Back side). Only Driving License is accepted.';
      } else {
        message = 'Uploaded document is not a valid Driving License. Please upload a clear photo of your original Driving License (Front & Back).';
      }
    } else if (lowerDef.includes('voter')) {
      message = 'Uploaded document is not a valid Voter ID card. Please upload a clear photo of your original Voter ID card (Front & Back).';
    } else {
      message = 'Uploaded document is not a valid Aadhaar card. Please upload a clear photo of your original Aadhaar card (Front & Back).';
    }
  }

  return { statusCode: statusCode === 500 && (lowerMsg.includes('compliant') || lowerMsg.includes('quality')) ? 400 : statusCode, message };
};
/**
 * Calculates Employee Profile Scoring System (100% Base Maximum)
 *
 * Scoring Criteria:
 * 1. Aadhaar Card = 20% (Verified = 20 pts, Not Verified = 0 pts)
 * 2. Voter ID Card = 20% (Verified = 20 pts, Not Verified = 0 pts)
 * 3. Education = 20% (Verified = 20 pts, Not Verified = 0 pts)
 * 4. Employment = 30% (Verified = 30 pts, Not Verified = 0 pts)
 * 5. Employee Reference = 10% Maximum
 *    - Up to 2 references allowed per employee
 *    - 0 verified references -> 0/10
 *    - 1 verified reference  -> 5/10 (Earned = 5, Applicable Target = 95)
 *    - 2 verified references -> 10/10 (Earned = 10, Applicable Target = 100)
 *    - Missing optional 2nd reference creates NO PENALTY (e.g. 95/95 = 100%)
 */
const calculateEmployeeScore = ({
  aadhaarDone = false,
  voterDone = false,
  eduDone = false,
  empDone = false,
  verifiedReferencesCount = 0,
} = {}) => {
  const isAadhaar = Boolean(aadhaarDone);
  const isVoter = Boolean(voterDone);
  const isEdu = Boolean(eduDone);
  const isEmp = Boolean(empDone);

  const aadhaarScore = isAadhaar ? 20 : 0;
  const voterScore = isVoter ? 20 : 0;
  const eduScore = isEdu ? 20 : 0;
  const empScore = isEmp ? 30 : 0;

  // Max 2 references allowed, 5 points each
  const validRefCount = Math.min(2, Math.max(0, Number(verifiedReferencesCount) || 0));
  const referenceScore = validRefCount * 5;

  const totalEarnedScore = aadhaarScore + voterScore + eduScore + empScore + referenceScore;

  // Total Applicable Score is ALWAYS fixed out of 100:
  // Aadhaar (20) + Voter (20) + Education (20) + Employment (30) + Reference (10) = 100
  const totalApplicableScore = 100;

  const finalPercentage = Math.min(100, Math.round((totalEarnedScore / totalApplicableScore) * 100));

  return {
    individualScores: {
      aadhaar: aadhaarScore,
      voter: voterScore,
      education: eduScore,
      employment: empScore,
      reference: referenceScore,
    },
    aadhaarScore,
    voterScore,
    eduScore,
    empScore,
    referenceScore,
    totalEarnedScore,
    totalApplicableScore,
    finalPercentage,
    verifiedReferencesCount: validRefCount,
    criteria: [
      { id: 'aadhaar', name: 'Aadhaar Card', weight: '20%', earned: aadhaarScore, max: 20, isVerified: isAadhaar },
      { id: 'voter', name: 'Voter ID Card', weight: '20%', earned: voterScore, max: 20, isVerified: isVoter },
      { id: 'education', name: 'Education', weight: '20%', earned: eduScore, max: 20, isVerified: isEdu },
      { id: 'employment', name: 'Employment', weight: '30%', earned: empScore, max: 30, isVerified: isEmp },
      {
        id: 'reference',
        name: 'Employee Reference',
        weight: '10% Max',
        earned: referenceScore,
        max: 10,
        isVerified: validRefCount > 0,
        verifiedCount: validRefCount,
        displayRatio: `${referenceScore}/10`,
      },
    ],
  };
};

const calculateEmployixScore = ({ aadhaarDone, voterDone, dlDone, empDone, eduDone, verifiedReferencesCount = 0 }) => {
  const result = calculateEmployeeScore({
    aadhaarDone,
    voterDone,
    eduDone,
    empDone,
    verifiedReferencesCount,
  });
  return result.finalPercentage;
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
  calculateEmployeeScore,
  calculateEmployixScore,
  calculateKycStatus,
  hashToken
};