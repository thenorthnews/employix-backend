const Tesseract = require('tesseract.js');
const logger = require('../utils/logger');

/**
 * Perform local OCR text recognition on an image buffer
 */
async function recognizeText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return '';
  try {
    const { data: { text } } = await Tesseract.recognize(buffer, 'eng');
    return (text || '').toLowerCase();
  } catch (err) {
    logger.warn('Local OCR text extraction failed', { error: err.message });
    return '';
  }
}

/**
 * Check if text contains explicit Aadhaar card keywords
 */
/**
 * Check if text contains explicit Aadhaar card keywords / patterns
 */
function isAadhaarDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  
  // Specific Aadhaar text indicators
  const hasAadhaarKeyword =
    t.includes('aadhaar') ||
    t.includes('aadhar') ||
    t.includes('adhar') ||
    t.includes('adhaar') ||
    t.includes('uidai') ||
    t.includes('unique identification') ||
    t.includes('authority of india') ||
    t.includes('mera aadhaar') ||
    t.includes('meri pehchan') ||
    t.includes('pehchan') ||
    t.includes('help@uidai') ||
    t.includes('government of india') ||
    t.includes('govt of india') ||
    t.includes('enrolment') ||
    t.includes('enrollment') ||
    t.includes('1947') ||
    t.includes('आधार') ||
    t.includes('पहचान') ||
    t.includes('સરકાર') ||
    t.includes('ઓળખ');

  // Format: 12 digits like "6645 2642 1992"
  const has12DigitPattern = /\b\d{4}\s\d{4}\s\d{4}\b/.test(t);

  // Common Aadhaar card fields
  const hasAadhaarFields =
    (t.includes('dob') || t.includes('birth') || t.includes('yob')) &&
    (t.includes('male') || t.includes('female'));

  return hasAadhaarKeyword || has12DigitPattern || hasAadhaarFields;
}

/**
 * Check if text contains explicit Voter ID card keywords
 */
function isVoterDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('election commission') ||
    t.includes('elector photo identity') ||
    t.includes('bharat nirvachan') ||
    t.includes('nirvachan aayog') ||
    t.includes('nirvachan') ||
    t.includes('electoral registration officer') ||
    t.includes('assembly constituency') ||
    t.includes('electoral roll') ||
    t.includes('polling station') ||
    t.includes('निर्वाचन') ||
    t.includes('मतदाता') ||
    t.includes('पहचान पत्र') ||
    /\b[a-z]{3}\d{7}\b/i.test(t) ||
    (t.includes('epic') && !t.includes('uidai') && !t.includes('aadhaar')) ||
    (t.includes('voter') && !t.includes('uidai') && !t.includes('aadhaar'))
  );
}

/**
 * Check if text contains Voter ID Back side indicators (strictly Voter-specific)
 */
function isVoterBackDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('electoral registration officer') ||
    t.includes('electoral roll') ||
    t.includes('assembly constituency') ||
    t.includes('constituency no') ||
    t.includes('polling station') ||
    t.includes('part no') ||
    t.includes('serial no') ||
    t.includes('parliamentary constituency') ||
    t.includes("father's name") ||
    t.includes('father name') ||
    t.includes("husband's name") ||
    t.includes('husband name') ||
    t.includes('विधान सभा') ||
    t.includes('निर्वाचन क्षेत्र') ||
    (t.includes('nirvachan') && t.includes('address')) ||
    (t.includes('voter') && t.includes('address')) ||
    (t.includes('election') && t.includes('address'))
  );
}

/**
 * Check if text contains PAN card indicators
 */
function isPanDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('income tax department') ||
    t.includes('permanent account number') ||
    t.includes('income tax') ||
    /\b[a-z]{5}\d{4}[a-z]\b/i.test(t)
  );
}

/**
 * Check if text contains explicit Driving License keywords / patterns
 */
function isDlDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();

  const hasDlKeyword =
    t.includes('driving licence') ||
    t.includes('driving license') ||
    t.includes('driver licence') ||
    t.includes('driver license') ||
    t.includes('licensing authority') ||
    t.includes('licence authority') ||
    t.includes('license authority') ||
    t.includes('motor vehicles') ||
    t.includes('motor vehicle') ||
    t.includes('transport department') ||
    t.includes('form 7') ||
    t.includes('form-7') ||
    t.includes('authorisation to drive') ||
    t.includes('authorization to drive') ||
    t.includes('chalak anugyapti') ||
    t.includes('चालन अनुज्ञप्ति') ||
    t.includes('ड्राइविंग लाइसेंस') ||
    t.includes('परिवहन विभाग') ||
    t.includes('परिवहन') ||
    t.includes('morth') ||
    t.includes('parivahan') ||
    t.includes('union of india');

  const hasDlPattern =
    /\bdl[-\s.]?no/i.test(t) ||
    /\bd\.l\.[-\s.]?no/i.test(t) ||
    /\blicen[cs]e[-\s.]?no/i.test(t) ||
    /\b[a-z]{2}[-\s/]?\d{2}[-\s/]?(?:19|20)\d{2}[-\s/]?\d{6,8}\b/i.test(t) ||
    /\b[a-z]{2}\d{13,15}\b/i.test(t);

  const hasVehicleClass =
    (t.includes('lmv') || t.includes('mcwg') || t.includes('mcwog') || t.includes('transport') || t.includes('non-transport')) &&
    (t.includes('valid') || t.includes('issue') || t.includes('rto') || t.includes('holder') || t.includes('dob'));

  return hasDlKeyword || hasDlPattern || hasVehicleClass;
}

/**
 * Check if text contains Driving License Back side indicators
 */
function isDlBackDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    isDlDocument(t) ||
    t.includes('endorsement') ||
    t.includes('endorsements') ||
    t.includes('class of vehicle') ||
    t.includes('non-transport') ||
    t.includes('motor vehicles act') ||
    t.includes('central motor vehicles') ||
    t.includes('cmvr') ||
    t.includes('blood group') ||
    t.includes('organ donor') ||
    t.includes('emergency contact') ||
    t.includes('badge no') ||
    t.includes('badge number') ||
    (t.includes('address') && (t.includes('licens') || t.includes('licenc') || t.includes('transport') || t.includes('rto') || t.includes('vehicle') || t.includes('holder') || t.includes('authority') || t.includes('valid') || t.includes('cov') || t.includes('issue'))) ||
    ((t.includes('validity') || t.includes('valid')) && (t.includes('nt') || t.includes('tr') || t.includes('cov') || t.includes('date')))
  );
}

/**
 * Validate that uploaded front and back images strictly belong to the expected document
 * @param {string} expectedType 'voter_id' | 'aadhaar' | 'driving_license'
 * @param {Buffer} frontBuffer
 * @param {Buffer} backBuffer
 */
async function validateDocumentConsistency({ expectedType, frontBuffer, backBuffer }) {
  if (!frontBuffer && !backBuffer) return;

  const [frontText, backText] = await Promise.all([
    frontBuffer ? recognizeText(frontBuffer) : Promise.resolve(''),
    backBuffer ? recognizeText(backBuffer) : Promise.resolve(''),
  ]);

  console.log("🔍 [Document OCR] Front Text:", frontText.slice(0, 150));
  console.log("🔍 [Document OCR] Back Text:", backText.slice(0, 150));

  const frontHasPan = isPanDocument(frontText);
  const backHasPan = isPanDocument(backText);

  const frontHasVoter = isVoterDocument(frontText);
  const backHasVoter = isVoterDocument(backText) || isVoterBackDocument(backText);

  const frontHasAadhaar = isAadhaarDocument(frontText) && !frontHasVoter && !frontHasPan;
  const backHasAadhaar = isAadhaarDocument(backText) && !backHasVoter && !backHasPan;

  const frontHasDl = isDlDocument(frontText) && !frontHasVoter && !frontHasAadhaar && !frontHasPan;
  const backHasDl = (isDlDocument(backText) || isDlBackDocument(backText)) && !backHasVoter && !backHasAadhaar && !backHasPan;

  logger.info('Document consistency pre-check analysis', {
    expectedType,
    frontHasAadhaar,
    backHasAadhaar,
    frontHasVoter,
    backHasVoter,
    frontHasDl,
    backHasDl,
    frontHasPan,
    backHasPan,
  });

  // ── 1. VOTER ID VALIDATION ──────────────────────────────────────────────
  if (expectedType === 'voter_id') {
    if (frontHasPan || backHasPan) {
      const err = new Error('PAN card detected. Please upload a valid Voter ID card.');
      err.statusCode = 400;
      throw err;
    }

    if (frontHasAadhaar || backHasAadhaar) {
      const err = new Error('Aadhaar card detected. Please upload a valid Voter ID card.');
      err.statusCode = 400;
      throw err;
    }

    if (frontHasDl || backHasDl) {
      const err = new Error('Driving License detected. Please upload a valid Voter ID card.');
      err.statusCode = 400;
      throw err;
    }

    if (!frontHasVoter) {
      const err = new Error('Please upload a valid Voter ID card (Front side). Only Voter ID card is accepted.');
      err.statusCode = 400;
      throw err;
    }

    if (!backHasVoter && !backText.includes('address')) {
      const err = new Error('Please upload a valid Voter ID card (Back side). Only Voter ID card is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }

  // ── 2. AADHAAR VALIDATION ───────────────────────────────────────────────
  if (expectedType === 'aadhaar') {
    // A. Reject PAN Card
    if (frontHasPan || backHasPan) {
      const err = new Error('PAN card detected. Please upload an Aadhaar card instead.');
      err.statusCode = 400;
      throw err;
    }

    // B. Reject Voter ID
    if (frontHasVoter || backHasVoter) {
      const err = new Error('Voter ID detected. Please upload an Aadhaar card instead.');
      err.statusCode = 400;
      throw err;
    }

    // C. Reject Driving License
    if (frontHasDl || backHasDl) {
      const err = new Error('Driving License detected. Please upload an Aadhaar card instead.');
      err.statusCode = 400;
      throw err;
    }

    // D. Front MUST be an actual Aadhaar card (rejects baby photos, selfies, blank, random images)
    if (!frontHasAadhaar) {
      const err = new Error('Please upload a valid Aadhaar card (Front side). Only Aadhaar card is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // E. Back MUST be an actual Aadhaar card back side
    const backIsAadhaar =
      backHasAadhaar ||
      backText.includes('help@uidai') ||
      backText.includes('1947') ||
      backText.includes('unique') ||
      backText.includes('authority') ||
      (backText.includes('address') && (backText.includes('uidai') || backText.includes('aadhaar') || backText.includes('s/o') || backText.includes('d/o') || backText.includes('c/o') || backText.includes('w/o')));

    if (!backIsAadhaar) {
      const err = new Error('Please upload a valid Aadhaar card (Back side). Only Aadhaar card is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }

  // ── 3. DRIVING LICENSE VALIDATION ───────────────────────────────────────
  if (expectedType === 'driving_license') {
    // A. Validate Front Side first
    if (frontHasPan) {
      const err = new Error('PAN card detected on Front side. Please upload a valid Driving License (Front side).');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasAadhaar) {
      const err = new Error('Aadhaar card detected on Front side. Please upload a valid Driving License (Front side).');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasVoter) {
      const err = new Error('Voter ID detected on Front side. Please upload a valid Driving License (Front side).');
      err.statusCode = 400;
      throw err;
    }
    if (!frontHasDl) {
      const err = new Error('Please upload a valid Driving License (Front side). Only Driving License is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // B. Validate Back Side second
    if (backHasPan) {
      const err = new Error('PAN card detected on Back side. Please upload a valid Driving License (Back side).');
      err.statusCode = 400;
      throw err;
    }
    if (backHasAadhaar) {
      const err = new Error('Aadhaar card detected on Back side. Please upload a valid Driving License (Back side).');
      err.statusCode = 400;
      throw err;
    }
    if (backHasVoter) {
      const err = new Error('Voter ID detected on Back side. Please upload a valid Driving License (Back side).');
      err.statusCode = 400;
      throw err;
    }
    const backIsDl =
      backHasDl ||
      isDlBackDocument(backText) ||
      (backText.includes('address') && (backText.includes('licens') || backText.includes('licenc') || backText.includes('transport') || backText.includes('rto') || backText.includes('vehicle') || backText.includes('holder') || backText.includes('valid'))) ||
      backText.includes('endorsement') ||
      backText.includes('non-transport') ||
      backText.includes('motor vehicles') ||
      backText.includes('transport') ||
      backText.includes('licensing');

    if (!backIsDl) {
      const err = new Error('Please upload a valid Driving License (Back side). Only Driving License is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = {
  recognizeText,
  isAadhaarDocument,
  isVoterDocument,
  isVoterBackDocument,
  isDlDocument,
  isDlBackDocument,
  validateDocumentConsistency,
};
