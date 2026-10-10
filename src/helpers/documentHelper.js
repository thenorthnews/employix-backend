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

  if (addressObj.fullAddress && typeof addressObj.fullAddress === 'string') {
    return addressObj.fullAddress.trim();
  }
  if (addressObj.formattedAddress && typeof addressObj.formattedAddress === 'string') {
    return addressObj.formattedAddress.trim();
  }
  if (addressObj.combinedAddress && typeof addressObj.combinedAddress === 'string') {
    return addressObj.combinedAddress.trim();
  }
  if (addressObj.rawAddress && typeof addressObj.rawAddress === 'string') {
    return addressObj.rawAddress.trim();
  }

  const parts = [
    addressObj.houseNumber || addressObj.building || addressObj.house || addressObj.careOf,
    addressObj.street || addressObj.streetAddress,
    addressObj.locality || addressObj.area,
    addressObj.landmark,
    addressObj.city || addressObj.district || addressObj.vtc || addressObj.subdist,
    addressObj.state,
    addressObj.pincode || addressObj.postalCode,
  ].filter(Boolean);

  return parts.length ? parts.join(', ') : null;
};

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
  'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'New Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Chandigarh', 'Puducherry', 'Andaman and Nicobar Islands', 'Dadra and Nagar Haveli', 'Daman and Diu'
];

/**
 * Intelligent Structured Address Parser
 * Converts full address strings or partial objects into { fullAddress, streetAddress, city, district, state, pincode }
 * Ensures streetAddress, city, district, state, pincode are populated whenever possible, avoiding nulls.
 */
const parseStructuredAddress = (rawAddress, splitAddress = {}) => {
  if (!rawAddress && (!splitAddress || Object.keys(splitAddress).length === 0)) {
    return {
      fullAddress: null,
      streetAddress: null,
      city: null,
      district: null,
      state: null,
      pincode: null,
    };
  }

  const split = typeof splitAddress === 'object' && splitAddress !== null ? { ...splitAddress } : {};
  let rawStr = '';

  if (typeof rawAddress === 'string') {
    rawStr = rawAddress.trim();
  } else if (rawAddress && typeof rawAddress === 'object') {
    rawStr =
      rawAddress.fullAddress ||
      rawAddress.formattedAddress ||
      rawAddress.combinedAddress ||
      rawAddress.rawAddress ||
      '';
    Object.keys(rawAddress).forEach((k) => {
      if (split[k] === undefined && typeof rawAddress[k] === 'string' && rawAddress[k].trim()) {
        split[k] = rawAddress[k].trim();
      }
    });
  }

  // 1. Pincode
  let pincode = split.pincode || split.postalCode || split.pin || null;
  if (!pincode && rawStr) {
    const pinMatch = rawStr.match(/\b([1-9][0-9]{5})\b/);
    if (pinMatch) {
      pincode = pinMatch[1];
    }
  }

  // 2. State
  let state = split.state || null;
  if (!state && rawStr) {
    const lowerRaw = rawStr.toLowerCase();
    for (const st of INDIAN_STATES) {
      const regex = new RegExp(`\\b${st.toLowerCase()}\\b`, 'i');
      if (regex.test(lowerRaw)) {
        state = st;
        break;
      }
    }
  }

  // 3. City & District
  let city = split.city || split.vtc || split.town || split.village || null;
  let district = split.district || split.subdist || split.subDistrict || null;

  // 4. Street / Building / House / Locality
  let streetAddress =
    split.streetAddress ||
    [split.houseNumber || split.house || split.building || split.careOf, split.street, split.locality || split.area || split.landmark]
      .filter(Boolean)
      .join(', ') ||
    null;

  // If we have rawStr and components are missing, parse from rawStr tokens
  if (rawStr) {
    let cleanText = rawStr.replace(/[-–—]?\s*\b[1-9][0-9]{5}\b/g, '').trim();
    let parts = cleanText
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (state && parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      if (lastPart.toLowerCase().includes(state.toLowerCase())) {
        parts.pop();
      }
    }

    if (!city && parts.length > 0) {
      city = parts.pop();
    }
    if (!district) {
      district = city || (parts.length > 0 ? parts[parts.length - 1] : null);
    }

    if (!streetAddress && parts.length > 0) {
      streetAddress = parts.join(', ');
    }
  }

  if (!city && district) city = district;
  if (!district && city) district = city;
  if (!streetAddress && (rawStr || city)) {
    streetAddress = rawStr || city;
  }

  const fullAddress =
    rawStr ||
    [streetAddress, city, district !== city ? district : null, state, pincode ? `- ${pincode}` : null]
      .filter(Boolean)
      .join(', ');

  return {
    fullAddress: fullAddress || null,
    streetAddress: streetAddress || null,
    city: city || null,
    district: district || null,
    state: state || null,
    pincode: pincode || null,
  };
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

  // For Aadhaar verification or name mismatch errors, preserve exact error response
  if (err.isNameMismatch || err.isSetuError || String(defaultMessage || '').toLowerCase().includes('aadhaar')) {
    return {
      statusCode,
      message: err.message || message,
    };
  }

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
const ScoreConfig = require('../products/user-portal/models/scoreConfig.model');

/**
 * Computes Score Breakdown given verification flags and dynamic ScoreConfig
 */
const computeScoreBreakdown = (
  {
    aadhaarDone = false,
    voterDone = false,
    eduDone = false,
    empDone = false,
    verifiedReferencesCount = 0,
  } = {},
  scoreConfig = {}
) => {
  const isAadhaar = Boolean(aadhaarDone);
  const isVoter = Boolean(voterDone);
  const isEdu = Boolean(eduDone);
  const isEmp = Boolean(empDone);

  const aadhaarMax = Number(scoreConfig.aadhaarScore ?? 20);
  const voterMax = Number(scoreConfig.voterScore ?? 20);
  const eduMax = Number(scoreConfig.educationScore ?? 20);
  const empMax = Number(scoreConfig.employmentScore ?? 30);
  const refPerItem = Number(scoreConfig.referenceScorePerItem ?? 5);
  const maxRefs = Number(scoreConfig.maxReferencesAllowed ?? 2);
  const refMax = refPerItem * maxRefs;
  const applicableTotal = Number(
    scoreConfig.totalApplicableScore ?? 100
  );

  const aadhaarScore = isAadhaar ? aadhaarMax : 0;
  const voterScore = isVoter ? voterMax : 0;
  const eduScore = isEdu ? eduMax : 0;
  const empScore = isEmp ? empMax : 0;

  // Max references allowed (default 2), points per item (5 to 5, default 5 each)
  const validRefCount = Math.min(maxRefs, Math.max(0, Number(verifiedReferencesCount) || 0));
  const referenceScore = validRefCount * refPerItem;

  const totalEarnedScore = aadhaarScore + voterScore + eduScore + empScore + referenceScore;
  const totalApplicableScore = applicableTotal > 0 ? applicableTotal : 100;

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
    scoreConfig: {
      aadhaarScore: aadhaarMax,
      voterScore: voterMax,
      educationScore: eduMax,
      employmentScore: empMax,
      referenceScorePerItem: refPerItem,
      maxReferencesAllowed: maxRefs,
      totalApplicableScore,
    },
    criteria: [
      { id: 'aadhaar', name: 'Aadhaar Card', weight: `${aadhaarMax}%`, earned: aadhaarScore, max: aadhaarMax, isVerified: isAadhaar },
      { id: 'voter', name: 'Voter ID Card', weight: `${voterMax}%`, earned: voterScore, max: voterMax, isVerified: isVoter },
      { id: 'education', name: 'Education', weight: `${eduMax}%`, earned: eduScore, max: eduMax, isVerified: isEdu },
      { id: 'employment', name: 'Employment', weight: `${empMax}%`, earned: empScore, max: empMax, isVerified: isEmp },
      {
        id: 'reference',
        name: 'Employee Reference',
        weight: `${refMax}% Max`,
        earned: referenceScore,
        max: refMax,
        isVerified: validRefCount > 0,
        verifiedCount: validRefCount,
        displayRatio: `${referenceScore}/${refMax}`,
      },
    ],
  };
};

/**
 * Calculates Employee Profile Scoring System dynamically from DB ScoreConfig table
 *
 * Scoring Criteria (dynamically configurable in score_configs table):
 * 1. Aadhaar Card = 20 pts default
 * 2. Voter ID Card = 20 pts default
 * 3. Education = 20 pts default
 * 4. Employment = 30 pts default
 * 5. Employee Reference = 5 to 5 (5 pts per reference, max 2 references = 10 pts default)
 * Total = 100 pts
 */
const calculateEmployeeScore = async (params = {}) => {
  const config = params?.config || (await ScoreConfig.getActiveConfig());
  return computeScoreBreakdown(params, config);
};

const calculateEmployeeScoreSync = (params = {}, customConfig = null) => {
  const config = customConfig || ScoreConfig.getCachedConfig();
  return computeScoreBreakdown(params, config);
};

const calculateEmployixScore = async ({
  aadhaarDone,
  voterDone,
  dlDone,
  empDone,
  eduDone,
  verifiedReferencesCount = 0,
  config = null,
} = {}) => {
  const result = await calculateEmployeeScore({
    aadhaarDone,
    voterDone,
    eduDone,
    empDone,
    verifiedReferencesCount,
    config,
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

/**
 * Normalizes a name string:
 * - Converts to lowercase
 * - Strips optional leading salutations (Mr, Mrs, Ms, Miss, Dr, Shri, Smt)
 * - Removes non-alphanumeric punctuation
 * - Normalizes multiple spaces into a single space
 * @param {string} str
 * @returns {string}
 */
const normalizeNameString = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/^(mr|mrs|ms|miss|dr|shri|smt)\.?\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Calculates Levenshtein distance between two strings
 */
const getLevenshteinDistance = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

/**
 * Checks if two words match exactly (case & whitespace normalized)
 */
const isWordMatching = (w1, w2) => {
  if (!w1 || !w2) return false;
  return w1.toLowerCase().trim() === w2.toLowerCase().trim();
};

/**
 * Validates if the name on the Aadhaar card matches the registered user's profile name.
 * Rule specification:
 * - "Neha Jolly" vs "NEHA JOLLY" -> Match (exact case-insensitive)
 * - "Neha Jolly" vs "Neha  Jolly" -> Match (space-insensitive)
 * - "Neha Jolly" vs "Neha Johly" -> Mismatch ("jolly" !== "johly")
 * - "Neha Jolly" vs "Neha Jolly Kumar" -> Mismatch (different word count)
 * - "Neha Jolly" vs "Neha Sharma" -> Mismatch (different last name)
 *
 * @param {string} registeredName
 * @param {string} docName
 * @param {string} docLabel
 * @returns {{ isMatch: boolean, reason?: string }}
 */
const validateDocumentNameMatch = (registeredName, docName, docLabel = 'Aadhaar') => {
  const normReg = normalizeNameString(registeredName);
  const normDoc = normalizeNameString(docName);

  if (!normReg || !normDoc) {
    return { isMatch: true };
  }

  // Exact match (case & whitespace insensitive)
  if (normReg === normDoc) {
    return { isMatch: true };
  }

  const regTokens = normReg.split(' ').filter(Boolean);
  const docTokens = normDoc.split(' ').filter(Boolean);

  // If word count is different (e.g. "Neha Jolly" vs "Neha Jolly Kumar") -> Mismatch
  if (regTokens.length !== docTokens.length) {
    return {
      isMatch: false,
      reason: `${docLabel} card name ("${docName}") does not match your registered profile name ("${registeredName}"). Full name must match exactly.`,
    };
  }

  // Same word count: check exact word-by-word in order
  const inOrderMatch = regTokens.every((token, idx) => token === docTokens[idx]);
  if (inOrderMatch) {
    return { isMatch: true };
  }

  // Permutation exact match (same exact words in different order e.g. "Jolly Neha" vs "Neha Jolly")
  const sortedReg = [...regTokens].sort();
  const sortedDoc = [...docTokens].sort();
  const permMatch = sortedReg.every((token, idx) => token === sortedDoc[idx]);
  if (permMatch) {
    return { isMatch: true };
  }

  return {
    isMatch: false,
    reason: `${docLabel} card name ("${docName}") does not match your registered profile name ("${registeredName}"). Full name must match your official ID exactly.`,
  };
};

const validateAadhaarNameMatch = (registeredName, aadhaarName) =>
  validateDocumentNameMatch(registeredName, aadhaarName, 'Aadhaar');

const validateDlNameMatch = (registeredName, dlName) =>
  validateDocumentNameMatch(registeredName, dlName, 'Driving License');

const validateEmploymentNameMatch = (registeredName, epfoName) =>
  validateDocumentNameMatch(registeredName, epfoName, 'Employment');

module.exports = {
  maskDocumentNumber,
  maskVoterId,
  extractFormattedAddress,
  parseStructuredAddress,
  parseDocumentDob,
  standardizeGender,
  generateSafeGroupId,
  getGatewayHeaders,
  resolveErrorInfo,
  calculateEmployeeScore,
  calculateEmployeeScoreSync,
  computeScoreBreakdown,
  calculateEmployixScore,
  calculateKycStatus,
  hashToken,
  validateDocumentNameMatch,
  validateAadhaarNameMatch,
  validateDlNameMatch,
  validateEmploymentNameMatch,
};