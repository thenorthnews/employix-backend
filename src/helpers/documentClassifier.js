const crypto = require('crypto');
const zlib = require('zlib');
const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const logger = require('../utils/logger');

/**
 * Check if buffer is a PDF document (starts with %PDF or has %PDF header)
 */
function isPdfBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  const header = buffer.slice(0, Math.min(buffer.length, 1024)).toString('latin1');
  return header.includes('%PDF');
}

/**
 * Extract embedded JPEG images from a scanned PDF buffer
 * Accurately parses stream ... endstream PDF blocks and extracts full, untruncated JPEG images
 */
function extractImagesFromPdfBuffer(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) return [];

  const images = [];
  const streamMarker = Buffer.from('stream');
  const endStreamMarker = Buffer.from('endstream');
  const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF]);
  const jpegFooter = Buffer.from([0xFF, 0xD9]);

  // Strategy 1: PDF Stream boundary extraction (Most accurate for standard PDF documents)
  let searchIndex = 0;
  while (searchIndex < pdfBuffer.length && images.length < 5) {
    const streamIndex = pdfBuffer.indexOf(streamMarker, searchIndex);
    if (streamIndex === -1) break;

    let dataStart = streamIndex + streamMarker.length;
    // Skip \r, \n, spaces after "stream"
    while (
      dataStart < pdfBuffer.length &&
      (pdfBuffer[dataStart] === 0x0D || pdfBuffer[dataStart] === 0x0A || pdfBuffer[dataStart] === 0x20)
    ) {
      dataStart++;
    }

    const endStreamIndex = pdfBuffer.indexOf(endStreamMarker, dataStart);
    if (endStreamIndex === -1) break;

    const streamChunk = pdfBuffer.slice(dataStart, endStreamIndex);
    const jpegStart = streamChunk.indexOf(jpegHeader);
    if (jpegStart !== -1) {
      const lastJpegEnd = streamChunk.lastIndexOf(jpegFooter);
      if (lastJpegEnd !== -1 && lastJpegEnd > jpegStart) {
        const fullImg = streamChunk.slice(jpegStart, lastJpegEnd + 2);
        // Valid photo inside PDF is at least 3KB
        if (fullImg.length > 3000) {
          images.push(fullImg);
        }
      }
    }

    searchIndex = endStreamIndex + endStreamMarker.length;
  }

  // Strategy 2: Raw byte scanning fallback if stream boundaries were not isolated
  if (images.length === 0) {
    let rawIndex = 0;
    while (rawIndex < pdfBuffer.length && images.length < 3) {
      const startIndex = pdfBuffer.indexOf(jpegHeader, rawIndex);
      if (startIndex === -1) break;

      const nextHeader = pdfBuffer.indexOf(jpegHeader, startIndex + 3);
      const searchLimit =
        nextHeader !== -1 ? nextHeader : Math.min(pdfBuffer.length, startIndex + 8 * 1024 * 1024);
      const sub = pdfBuffer.slice(startIndex, searchLimit);
      const lastFooter = sub.lastIndexOf(jpegFooter);

      if (lastFooter !== -1 && lastFooter > 3000) {
        images.push(sub.slice(0, lastFooter + 2));
      }
      rawIndex = searchLimit;
    }
  }

  return images;
}

/**
 * Fast and accurate scanning of PDF binary buffer for document signatures (DL, PAN, Voter, Aadhaar)
 */
function scanPdfBufferForSignatures(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return {};
  const str = buffer.toString('latin1').toLowerCase();

  const hasDl =
    (str.includes('driving') && (str.includes('licen') || str.includes('licenc') || str.includes('rto'))) ||
    str.includes('union of india') ||
    str.includes('class of vehicle') ||
    str.includes('transport department') ||
    str.includes('motor vehicles act');

  const hasPan =
    str.includes('income tax department') ||
    str.includes('permanent account number') ||
    /\b[a-z]{5}\d{4}[a-z]\b/i.test(str);

  const hasVoter =
    str.includes('election commission') ||
    str.includes('elector photo identity') ||
    str.includes('निर्वाचन आयोग') ||
    str.includes('मतदाता पहचान') ||
    /\b[a-z]{3}\d{7}\b/i.test(str);

  const hasAadhaar =
    str.includes('aadhaar') ||
    str.includes('aadhar') ||
    str.includes('uidai') ||
    str.includes('मेरा आधार') ||
    str.includes('meri pehchan') ||
    str.includes('unique identification');

  return { hasDl, hasPan, hasVoter, hasAadhaar };
}

/**
 * Text extraction from PDF:
 * 1. Digital text via pdf-parse
 * 2. Decompressed PDF FlateDecode page streams via zlib (words only)
 * 3. OCR on embedded images (scanned PDFs)
 */
async function extractTextFromPdf(buffer) {
  let combinedText = '';

  // 1. Digital text via pdf-parse
  try {
    const pdfData = await pdfParse(buffer);
    const parsedText = (pdfData?.text || '').trim().toLowerCase();
    if (parsedText.length > 0) {
      combinedText += ' ' + parsedText;
    }
  } catch (pdfErr) {
    // Ignore invalid stream or damaged structure in scanned PDFs
  }

  // 2. Extract and decompress FlateDecode streams in PDF (Page content, text objects)
  try {
    const streamMarker = Buffer.from('stream');
    const endStreamMarker = Buffer.from('endstream');
    let searchIndex = 0;

    while (searchIndex < buffer.length && combinedText.length < 5000) {
      const sIdx = buffer.indexOf(streamMarker, searchIndex);
      if (sIdx === -1) break;

      let dStart = sIdx + streamMarker.length;
      while (
        dStart < buffer.length &&
        (buffer[dStart] === 0x0D || buffer[dStart] === 0x0A || buffer[dStart] === 0x20)
      ) {
        dStart++;
      }

      const eIdx = buffer.indexOf(endStreamMarker, dStart);
      if (eIdx === -1) break;

      const chunk = buffer.slice(dStart, eIdx);
      try {
        const decompressed = zlib.inflateSync(chunk);
        const decStr = decompressed.toString('utf8');
        // Extract real printable words only (exclude raw binary symbols)
        const words = decStr.match(/[a-zA-Z\u0900-\u097F]{3,}/g);
        if (words && words.length > 0) {
          combinedText += ' ' + words.join(' ').toLowerCase();
        }
      } catch {
        // Not a zlib compressed stream, skip
      }

      searchIndex = eIdx + endStreamMarker.length;
    }
  } catch {}

  // 3. Try OCR on embedded images if present (Scanned PDF)
  try {
    const embeddedImages = extractImagesFromPdfBuffer(buffer);
    if (embeddedImages.length > 0) {
      const { data: { text: ocrText } } = await Tesseract.recognize(embeddedImages[0], 'eng');
      if (ocrText) {
        combinedText += ' ' + ocrText.toLowerCase();
      }
    }
  } catch (imgErr) {
    logger.warn('Failed to OCR embedded image from scanned PDF', { error: imgErr.message });
  }

  return combinedText.trim();
}

/**
 * Extract image width, height, and format from binary buffer (JPEG, PNG, WebP)
 */
function getImageDimensions(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
  }

  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length - 8) {
      if (buffer[offset] !== 0xFF) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (
        (marker >= 0xC0 && marker <= 0xC3) ||
        (marker >= 0xC5 && marker <= 0xC7) ||
        (marker >= 0xC9 && marker <= 0xCB) ||
        (marker >= 0xCD && marker <= 0xCF)
      ) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return { width, height, format: 'jpeg' };
      }
      const len = buffer.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
  }

  // WebP
  if (
    buffer.length > 30 &&
    buffer.slice(0, 4).toString('latin1') === 'RIFF' &&
    buffer.slice(8, 12).toString('latin1') === 'WEBP'
  ) {
    const chunkType = buffer.slice(12, 16).toString('latin1');
    if (chunkType === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
        format: 'webp',
      };
    }
    if (chunkType === 'VP8X') {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
        format: 'webp',
      };
    }
  }

  return null;
}

/**
 * Check if text contains Passport markers
 */
function isPassportDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    (t.includes('passport') || t.includes('pass port')) &&
    (t.includes('republic of india') ||
      t.includes('भारत गणराज्य') ||
      t.includes('type/type') ||
      t.includes('country code') ||
      t.includes('given name'))
  );
}

/**
 * Perform local text extraction on an image or PDF buffer with confidence & word metrics
 */
async function recognizeDetailedText(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { text: '', confidence: 0, words: [], isPdf: false };
  }

  if (isPdfBuffer(buffer)) {
    const text = await extractTextFromPdf(buffer);
    const words = text ? text.split(/\s+/).filter(Boolean) : [];
    return { text, confidence: 95, words, isPdf: true };
  }

  try {
    const { data } = await Tesseract.recognize(buffer, 'eng');
    const text = (data?.text || '').toLowerCase();
    const confidence = typeof data?.confidence === 'number' ? data.confidence : 0;
    const words = Array.isArray(data?.words) ? data.words : [];
    return { text, confidence, words, isPdf: false };
  } catch (err) {
    logger.warn('Local OCR image text extraction failed', { error: err.message });
    return { text: '', confidence: 0, words: [], isPdf: false };
  }
}

/**
 * Perform local text extraction on an image or PDF buffer
 * - Digital & scanned PDF: extracted via pdf-parse, zlib stream decompression, and OCR
 * - Images (PNG/JPEG/WEBP): extracted directly via Tesseract OCR
 */
async function recognizeText(buffer) {
  const result = await recognizeDetailedText(buffer);
  return result.text;
}

// ─────────────────────────────────────────────────────────────────────────────
// AADHAAR CARD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if text contains explicit Aadhaar card keywords / patterns
 */
function isAadhaarDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const normalized = t.replace(/\s+/g, ' ');

  const hasAadhaarKeyword =
    t.includes('aadhaar') ||
    t.includes('aadhar') ||
    t.includes('adhar') ||
    t.includes('adhaar') ||
    t.includes('uidai') ||
    t.includes('eaadhaar') ||
    t.includes('e-aadhaar') ||
    normalized.includes('unique identification authority') ||
    normalized.includes('unique identification') ||
    (t.includes('unique') && t.includes('identification')) ||
    normalized.includes('authority of india') ||
    t.includes('mera aadhaar') ||
    t.includes('meri pehchan') ||
    t.includes('help@uidai') ||
    t.includes('आधार') ||
    t.includes('मेरा आधार') ||
    t.includes('मेरी पहचान') ||
    t.includes('विशिष्ट पहचान') ||
    (t.includes('1947') && (t.includes('uidai') || t.includes('help') || t.includes('toll')));

  // Format: 12 digits like "6645 2642 1992" or "664526421992", masked "XXXX XXXX 1992", or 16-digit VID
  const has12DigitPattern =
    /\b\d{4}\s\d{4}\s\d{4}\b/.test(t) ||
    /\b\d{12}\b/.test(t) ||
    /[xX\*\.]{4}\s?[xX\*\.]{4}\s?\d{4}/.test(t) ||
    /\b\d{4}\s\d{4}\s\d{4}\s\d{4}\b/.test(t);

  // Government of India + Aadhaar specific fields
  const hasAadhaarFields =
    (t.includes('government of india') || t.includes('govt of india') || t.includes('भारत सरकार')) &&
    (t.includes('enrolment') ||
      t.includes('enrollment') ||
      t.includes('नामांकन') ||
      t.includes('vid') ||
      ((t.includes('dob') || t.includes('yob') || t.includes('birth') || t.includes('जन्म')) &&
        (t.includes('male') || t.includes('female') || t.includes('पुरुष') || t.includes('महिला'))));

  return Boolean(hasAadhaarKeyword || has12DigitPattern || hasAadhaarFields);
}

/**
 * Check if text specifically belongs to Aadhaar Front side
 */
function isAadhaarFrontDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const normalized = t.replace(/\s+/g, ' ');

  const hasAadhaarWord =
    t.includes('aadhaar') ||
    t.includes('aadhar') ||
    t.includes('adhar') ||
    t.includes('uidai') ||
    normalized.includes('unique identification') ||
    (t.includes('unique') && t.includes('identification')) ||
    t.includes('आधार') ||
    t.includes('mera aadhaar') ||
    t.includes('meri pehchan') ||
    t.includes('मेरा आधार') ||
    t.includes('मेरी पहचान');

  const has12Digits =
    /\b\d{4}\s\d{4}\s\d{4}\b/.test(t) ||
    /\b\d{12}\b/.test(t) ||
    /[xX\*\.]{4}\s?[xX\*\.]{4}\s?\d{4}/.test(t) ||
    /\b\d{4}\s\d{4}\s\d{4}\s\d{4}\b/.test(t);

  const hasDobOrYob =
    t.includes('dob') ||
    t.includes('birth') ||
    t.includes('yob') ||
    t.includes('जन्म') ||
    /\b(0[1-9]|[12][0-9]|3[01])[\/\-\.](0[1-9]|1[012])[\/\-\.](19|20)\d\d\b/.test(t);

  const hasGender =
    t.includes('male') ||
    t.includes('female') ||
    t.includes('transgender') ||
    t.includes('पुरुष') ||
    t.includes('महिला');

  const hasAddress = t.includes('address') || t.includes('पता');
  const hasUidaiHelp = t.includes('help@uidai') || t.includes('1947');

  // If text is purely back side (address + helpdesk without DOB / gender / 12-digit)
  if (hasAddress && hasUidaiHelp && !hasDobOrYob && !hasGender && !has12Digits) {
    return false;
  }

  return (hasAadhaarWord || has12Digits) && (hasDobOrYob || hasGender || hasAadhaarWord);
}

/**
 * Check if text specifically belongs to Aadhaar Back side
 * MUST contain an Aadhaar-specific anchor (UIDAI, 1947, Aadhaar, Unique Identification)
 */
function isAadhaarBackDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const normalized = t.replace(/\s+/g, ' ');

  // 1. Mandatory Aadhaar anchor: Without this, it can NEVER be an Aadhaar back!
  const hasAadhaarAnchor =
    t.includes('uidai') ||
    t.includes('help@uidai') ||
    t.includes('1947') ||
    normalized.includes('unique identification') ||
    (t.includes('unique') && t.includes('identification')) ||
    normalized.includes('authority of india') ||
    t.includes('भारतीय विशिष्ट पहचान') ||
    t.includes('mera aadhaar') ||
    t.includes('meri pehchan') ||
    t.includes('aadhaar') ||
    t.includes('aadhar') ||
    t.includes('आधार');

  if (!hasAadhaarAnchor) {
    return false;
  }

  // 2. Must contain back details: Address, Parentage, PIN, or UIDAI helpdesk
  const hasAddress = t.includes('address') || t.includes('पता') || /\b[1-9][0-9]{5}\b/.test(t);
  const hasParentCare =
    t.includes('c/o') ||
    t.includes('s/o') ||
    t.includes('d/o') ||
    t.includes('w/o') ||
    t.includes('आत्मज') ||
    t.includes('पत्नी') ||
    t.includes('पुत्र') ||
    t.includes('पुत्री');
  const hasUidaiHelp = t.includes('help@uidai') || t.includes('1947') || t.includes('authority');

  // If text is purely front (12-digit number + DOB + gender with NO address and NO helpdesk)
  const has12Digits =
    /\b\d{4}\s\d{4}\s\d{4}\b/.test(t) ||
    /\b\d{12}\b/.test(t) ||
    /[xX\*\.]{4}\s?[xX\*\.]{4}\s?\d{4}/.test(t);
  const hasDobOrYob = t.includes('dob') || t.includes('birth') || t.includes('yob');
  const hasGender = t.includes('male') || t.includes('female');

  if (has12Digits && hasDobOrYob && hasGender && !hasAddress && !hasUidaiHelp && !hasParentCare) {
    return false;
  }

  return Boolean(hasAddress || hasParentCare || hasUidaiHelp);
}

// ─────────────────────────────────────────────────────────────────────────────
// VOTER ID CARD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * General check if text contains any Voter ID card keywords or patterns
 */
function isVoterDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const normalized = t.replace(/\s+/g, ' ');

  const hasElectionCommission =
    normalized.includes('election commission') ||
    (t.includes('election') && t.includes('commission'));

  const hasElectorIdentity =
    normalized.includes('elector photo identity') ||
    (t.includes('elector') && t.includes('identity')) ||
    (t.includes('elector') && t.includes('photo')) ||
    t.includes('मतदाता पहचान पत्र') ||
    t.includes('पहचान पत्र') ||
    t.includes('elector');

  const hasNirvachan =
    t.includes('nirvachan') ||
    t.includes('निर्वाचन') ||
    t.includes('मतदाता') ||
    t.includes('matdata');

  const hasConstituency =
    t.includes('constituency') ||
    t.includes('electoral roll') ||
    (t.includes('polling') && t.includes('station')) ||
    t.includes('विधान सभा') ||
    t.includes('निर्वाचन क्षेत्र');

  const hasElectoralOfficer =
    t.includes('electoral registration') ||
    (t.includes('electoral') && t.includes('officer')) ||
    t.includes('निर्वाचक रजिस्ट्रीकरण') ||
    t.includes('निर्वाचक') ||
    t.includes('electoral');

  const hasEciHelpline =
    t.includes('eci.gov.in') ||
    t.includes('1950') ||
    normalized.includes('eci ') ||
    t.includes('भारत निर्वाचन');

  const hasEpicRegex = /\b[a-z]{3}\d{7}\b/i.test(t);
  const hasEpicWord = (t.includes('epic') || t.includes('epic no') || t.includes('epic/')) && !t.includes('uidai') && !t.includes('aadhaar');
  const hasVoterWord = t.includes('voter') && !t.includes('uidai') && !t.includes('aadhaar');

  return Boolean(
    hasElectionCommission ||
    hasElectorIdentity ||
    hasNirvachan ||
    hasConstituency ||
    hasElectoralOfficer ||
    hasEciHelpline ||
    hasEpicRegex ||
    hasEpicWord ||
    hasVoterWord
  );
}

/**
 * Strictly checks for Voter ID FRONT side only
 */
function isVoterFrontDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('uidai') || t.includes('aadhaar') || t.includes('aadhar') || t.includes('आधार') || t.includes('pan card') || t.includes('income tax department')) {
    return false;
  }
  const normalized = t.replace(/\s+/g, ' ');

  const hasFrontKeyword =
    normalized.includes('elector photo identity') ||
    normalized.includes('elector identity') ||
    t.includes('मतदाता पहचान पत्र') ||
    normalized.includes("elector's name") ||
    normalized.includes('elector name') ||
    normalized.includes('election commission of india') ||
    t.includes('भारत निर्वाचन आयोग');

  const hasGender = t.includes('male') || t.includes('female') || t.includes('लिंग') || t.includes('gender') || t.includes('sex');
  const hasDobOrAge = t.includes('dob') || t.includes('date of birth') || t.includes('जन्म तिथि') || t.includes('age') || t.includes('आयु');
  const hasFather = t.includes("father's name") || t.includes('father name') || t.includes('पिता का नाम') || t.includes("husband's name") || t.includes('पति का नाम');

  const backUniqueMarkers = [
    'electoral registration officer',
    'निर्वाचक रजिस्ट्रीकरण अधिकारी',
    'assembly constituency',
    'विधान सभा निर्वाचन क्षेत्र',
    'polling station',
    'मतदान केंद्र',
    'part no',
    'भाग संख्या',
    'serial no',
    'क्रम संख्या',
    'parliamentary constituency',
  ];
  const backScore = backUniqueMarkers.filter(m => t.includes(m)).length;
  const hasAddress = t.includes('address') || t.includes('पता:') || t.includes('पता');

  // If back markers/address are present and lacks front demographics (father, gender, dob), reject as front
  if ((backScore >= 1 || hasAddress) && !hasFather && !hasGender && !hasDobOrAge) {
    return false;
  }

  // Pure front if it has father's name or gender + dob or front header with demographics
  if (hasFather) return true;
  if (hasGender && hasDobOrAge) return true;
  if (hasFrontKeyword && (hasGender || hasDobOrAge || hasFather)) return true;
  if (hasFrontKeyword && backScore === 0 && !hasAddress) return true;

  return false;
}

/**
 * Strictly checks for Voter ID BACK side only
 */
function isVoterBackDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('uidai') || t.includes('aadhaar') || t.includes('aadhar') || t.includes('आधार') || t.includes('pan card') || t.includes('income tax department')) {
    return false;
  }

  const backMarkers = [
    'electoral registration officer',
    'निर्वाचक रजिस्ट्रीकरण अधिकारी',
    'assembly constituency',
    'constituency no',
    'विधान सभा',
    'निर्वाचन क्षेत्र',
    'polling station',
    'मतदान केंद्र',
    'मतदान स्थल',
    'part no',
    'part number',
    'भाग संख्या',
    'serial no',
    'क्रम संख्या',
    'parliamentary constituency',
    'संसदीय निर्वाचन क्षेत्र',
    'date of download',
  ];

  const hasAddress = t.includes('address') || t.includes('पता') || t.includes('residential address');
  const backMatches = backMarkers.filter(m => t.includes(m)).length;

  const hasFather = t.includes("father's name") || t.includes('father name') || t.includes('पिता का नाम') || t.includes("husband's name");
  const hasGender = t.includes('male') || t.includes('female') || t.includes('लिंग');
  const hasDobOrAge = t.includes('dob') || t.includes('date of birth') || t.includes('जन्म तिथि');

  // If text is clearly front (has father/gender/dob with NO address and NO back markers), it is NOT back
  if ((hasFather || hasGender || hasDobOrAge) && !hasAddress && backMatches === 0) {
    return false;
  }

  if (hasAddress && (backMatches >= 1 || t.includes('election') || t.includes('nirvachan') || t.includes('voter') || t.includes('commission') || t.includes('officer') || t.includes('eci'))) {
    return true;
  }

  if (backMatches >= 1) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAN CARD HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if text contains PAN card indicators
 */
function isPanDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const normalized = t.replace(/\s+/g, ' ');
  return (
    normalized.includes('income tax department') ||
    (t.includes('income') && t.includes('tax')) ||
    normalized.includes('permanent account number') ||
    /\b[a-z]{5}\d{4}[a-z]\b/i.test(t)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DRIVING LICENSE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if text contains basic Driving License indicators
 */
function isDlDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('uidai') || t.includes('unique identification') || t.includes('aadhaar') || t.includes('aadhar') || t.includes('आधार')) {
    return false;
  }
  const normalized = t.replace(/\s+/g, ' ');

  const hasDrivingLicence =
    normalized.includes('driving licence') ||
    normalized.includes('driving license') ||
    (t.includes('driving') && (t.includes('licence') || t.includes('license') || t.includes('licen')));

  const hasUnionOfIndia =
    normalized.includes('union of india') ||
    (t.includes('union') && t.includes('india'));

  const hasTransportDept =
    normalized.includes('transport department') ||
    (t.includes('transport') && (t.includes('department') || t.includes('dept') || t.includes('authority') || t.includes('delhi') || t.includes('govt')));

  const hasDlNumber =
    /[a-z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}/i.test(t) ||
    /[a-z]{2}[0-9]{2}[ -]?[0-9]{11}/i.test(t) ||
    /\b[a-z]{2}[0-9]{2}\s?[0-9]{11}\b/i.test(t) ||
    t.includes('dl no') ||
    t.includes('licence no') ||
    t.includes('license no');

  const hasDlBackMarkers =
    normalized.includes('class of vehicle') ||
    t.includes('blood group') ||
    t.includes('blood grp') ||
    t.includes('endorsement') ||
    t.includes('motor vehicles act');

  return Boolean(
    hasDrivingLicence ||
    hasUnionOfIndia ||
    hasTransportDept ||
    hasDlNumber ||
    hasDlBackMarkers
  );
}

/**
 * Strictly checks for DL FRONT side only
 */
function isDlFrontDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('uidai') || t.includes('unique identification') || t.includes('aadhaar') || t.includes('aadhar') || t.includes('आधार')) {
    return false;
  }
  const normalized = t.replace(/\s+/g, ' ');

  const hasDlHeader =
    normalized.includes('driving licence') ||
    normalized.includes('driving license') ||
    (t.includes('driving') && (t.includes('licence') || t.includes('license'))) ||
    normalized.includes('union of india') ||
    normalized.includes('indian union') ||
    (t.includes('union') && t.includes('india')) ||
    normalized.includes('transport department') ||
    (t.includes('transport') && (t.includes('department') || t.includes('dept') || t.includes('authority') || t.includes('delhi') || t.includes('punjab') || t.includes('chandigarh') || t.includes('haryana') || t.includes('govt'))) ||
    t.includes('issued by') ||
    t.includes('motor vehicles act');

  const hasDlNumber =
    /[a-z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}/i.test(t) ||
    /[a-z]{2}[0-9]{2}[ -]?[0-9]{11}/i.test(t) ||
    /\b[a-z]{2}[0-9]{2}\s?[0-9]{11}\b/i.test(t) ||
    t.includes('dl no') ||
    t.includes('licence no') ||
    t.includes('license no');

  const hasDob =
    t.includes('dob') ||
    t.includes('date of birth') ||
    t.includes('d.o.b') ||
    t.includes('birth:') ||
    t.includes('जन्म तिथि');

  const hasParent =
    t.includes('s/o') ||
    t.includes('d/o') ||
    t.includes('w/o') ||
    t.includes('s/0') ||
    t.includes('son of') ||
    t.includes('daughter of') ||
    t.includes('wife of') ||
    t.includes('son/daughter/wife') ||
    t.includes('father') ||
    t.includes('husband');

  const hasName =
    t.includes('name:') ||
    t.includes('name :') ||
    normalized.includes('licensee name');

  if (hasDlHeader || hasDlNumber) return true;
  if (hasParent || hasDob || hasName) return true;

  return false;
}

/**
 * Strictly checks for DL BACK side only
 */
function isDlBackDocument(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (t.includes('uidai') || t.includes('unique identification') || t.includes('aadhaar') || t.includes('aadhar') || t.includes('आधार')) {
    return false;
  }
  const normalized = t.replace(/\s+/g, ' ');

  const hasFrontHeader =
    normalized.includes('union of india') ||
    normalized.includes('indian union') ||
    normalized.includes('driving licence') ||
    normalized.includes('driving license');

  const hasDlNumber =
    /[a-z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}/i.test(t) ||
    /[a-z]{2}[0-9]{2}[ -]?[0-9]{11}/i.test(t) ||
    /\b[a-z]{2}[0-9]{2}\s?[0-9]{11}\b/i.test(t);

  // If text has Front Header or DL Number, it is FRONT side, NOT back!
  if (hasFrontHeader || hasDlNumber) {
    return false;
  }

  // True back side unique markers
  const backUniqueMarkers = [
    'emergency contact',
    'badge no',
    'badge number',
    'badge issued',
    'invalid carriage',
    'hazardous validity',
    'hill validity',
    'form 7',
    'valid throughout india',
    'throughout india',
  ];
  const backCount = backUniqueMarkers.filter((m) => t.includes(m)).length;
  if (backCount >= 1) {
    return true;
  }

  const hasAddress =
    t.includes('residential address') ||
    t.includes('permanent address') ||
    (t.includes('address') && (t.includes('pin') || t.includes('house') || t.includes('village')));

  if (hasAddress && (t.includes('licensing authority') || t.includes('authority') || t.includes('rto'))) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CONSISTENCY VALIDATOR (Applies strictly to Images & PDFs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate that uploaded front and back files strictly belong to the expected document
 * and ensure that Front is uploaded in Front slot and Back is uploaded in Back slot.
 * Enforces strict Front and Back separation for BOTH images and PDFs.
 *
 * @param {string} expectedType 'voter_id' | 'aadhaar' | 'driving_license' | 'pan'
 * @param {Buffer} frontBuffer
 * @param {Buffer} backBuffer
 */
async function validateDocumentConsistency({ expectedType, frontBuffer, backBuffer, frontFilename = '', backFilename = '' }) {
  if (!frontBuffer && !backBuffer) return;

  const frontIsPdf = isPdfBuffer(frontBuffer);
  const backIsPdf = isPdfBuffer(backBuffer);

  // 1. Strict equality check: Front and Back must NEVER be the exact same file (applies to images AND PDFs)
  if (frontBuffer && backBuffer && Buffer.isBuffer(frontBuffer) && Buffer.isBuffer(backBuffer)) {
    if (frontBuffer.equals(backBuffer)) {
      const docLabel = frontIsPdf ? 'PDF' : 'image';
      const err = new Error(`Front and Back side cannot be the same ${docLabel}. Please upload Front and Back sides separately.`);
      err.statusCode = 400;
      throw err;
    }

    const frontHash = crypto.createHash('sha256').update(frontBuffer).digest('hex');
    const backHash = crypto.createHash('sha256').update(backBuffer).digest('hex');
    if (frontHash === backHash) {
      const docLabel = frontIsPdf ? 'PDF' : 'image';
      const err = new Error(`Front and Back side cannot be the same ${docLabel}. Please upload Front and Back sides separately.`);
      err.statusCode = 400;
      throw err;
    }
  }

  const [frontRes, backRes] = await Promise.all([
    frontBuffer
      ? recognizeDetailedText(frontBuffer)
      : Promise.resolve({ text: '', confidence: 0, words: [], isPdf: false }),
    backBuffer
      ? recognizeDetailedText(backBuffer)
      : Promise.resolve({ text: '', confidence: 0, words: [], isPdf: false }),
  ]);

  const frontText = frontRes.text;
  const backText = backRes.text;

  if (
    frontText &&
    backText &&
    frontText.trim().length > 30 &&
    backText.trim().length > 30
  ) {
    const normFront = frontText.replace(/\s+/g, ' ').trim();
    const normBack = backText.replace(/\s+/g, ' ').trim();
    if (normFront === normBack) {
      const docLabel = frontIsPdf ? 'PDF' : 'image';
      const err = new Error(`Front and Back side ${docLabel} appear to be identical. Please upload Front and Back sides separately.`);
      err.statusCode = 400;
      throw err;
    }
  }

  const frontPdfSigs = frontIsPdf ? scanPdfBufferForSignatures(frontBuffer) : {};
  const backPdfSigs = backIsPdf ? scanPdfBufferForSignatures(backBuffer) : {};

  const frontHasPan = isPanDocument(frontText) || Boolean(frontPdfSigs.hasPan);
  const backHasPan = isPanDocument(backText) || Boolean(backPdfSigs.hasPan);

  const frontHasVoter = isVoterDocument(frontText) || Boolean(frontPdfSigs.hasVoter);
  const backHasVoter = isVoterDocument(backText) || isVoterBackDocument(backText) || Boolean(backPdfSigs.hasVoter);

  const frontHasDl = (isDlDocument(frontText) || Boolean(frontPdfSigs.hasDl)) && !frontHasVoter && !frontHasPan && !isAadhaarDocument(frontText);
  const backHasDl = (isDlDocument(backText) || isDlBackDocument(backText) || Boolean(backPdfSigs.hasDl)) && !backHasVoter && !backHasPan && !isAadhaarDocument(backText) && !isAadhaarBackDocument(backText);

  const frontHasAadhaar = (isAadhaarDocument(frontText) || Boolean(frontPdfSigs.hasAadhaar)) && !frontHasVoter && !frontHasPan && !frontHasDl;
  const backHasAadhaar = (isAadhaarDocument(backText) || Boolean(backPdfSigs.hasAadhaar)) && !backHasVoter && !backHasPan && !backHasDl;

  const frontHasExtractableText = Boolean(frontText && frontText.trim().length >= 25);
  const backHasExtractableText = Boolean(backText && backText.trim().length >= 25);

  logger.info('Document consistency pre-check analysis', {
    expectedType,
    frontIsPdf,
    backIsPdf,
    frontTextLen: frontText?.length || 0,
    backTextLen: backText?.length || 0,
    frontMatchedDoc: frontHasAadhaar,
    backMatchedDoc: backHasAadhaar,
    frontHasVoter,
    backHasVoter,
    frontHasDl,
    backHasDl,
    frontHasPan,
    backHasPan,
  });

  // ── 1. VOTER ID VALIDATION (Images & PDFs) ──────────────────────────────
  if (expectedType === 'voter_id') {
    // Cross-document rejection: PAN
    if (frontHasPan || backHasPan || isPanDocument(frontText) || isPanDocument(backText)) {
      const err = new Error('PAN card detected. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Cross-document rejection: Aadhaar
    if (frontHasAadhaar || backHasAadhaar || isAadhaarDocument(frontText) || isAadhaarDocument(backText)) {
      const err = new Error('Aadhaar card detected. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Cross-document rejection: DL
    if (frontHasDl || backHasDl || isDlDocument(frontText) || isDlDocument(backText) || isDlBackDocument(backText)) {
      const err = new Error('Driving License detected. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Cross-document rejection: Passport
    if (isPassportDocument(frontText) || isPassportDocument(backText)) {
      const err = new Error('Passport detected. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Filename heuristic checks
    const fName = (frontFilename || '').toLowerCase();
    const bName = (backFilename || '').toLowerCase();
    const isBackFilename = (str) => /(^|[^a-z0-9])(back|piche|rear|bck)($|[^a-z0-9])/i.test(str) || /[-_.]back[-_.]/i.test(str) || /voter[-_\s]*back/i.test(str);
    const isFrontFilename = (str) => /(^|[^a-z0-9])(front|aage|frnt)($|[^a-z0-9])/i.test(str) || /[-_.]front[-_.]/i.test(str) || /voter[-_\s]*front/i.test(str);

    if (fName && isBackFilename(fName) && !isFrontFilename(fName)) {
      const err = new Error('Voter ID (Back side) detected in Front side upload. Please upload the Front side of your Voter ID.');
      err.statusCode = 400;
      throw err;
    }
    if (bName && isFrontFilename(bName) && !isBackFilename(bName)) {
      const err = new Error('Voter ID (Front side) detected in Back side upload. Please upload the Back side of your Voter ID.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Slot Position Checks
    const voterBackMarkers = [
      'electoral registration officer',
      'निर्वाचक रजिस्ट्रीकरण अधिकारी',
      'assembly constituency',
      'विधान सभा',
      'निर्वाचन क्षेत्र',
      'polling station',
      'मतदान केंद्र',
      'part no',
      'भाग संख्या',
      'serial no',
      'क्रम संख्या',
      'parliamentary constituency',
    ];
    const frontVoterBackMatches = voterBackMarkers.filter((m) => frontText.toLowerCase().includes(m)).length;
    const backVoterBackMatches = voterBackMarkers.filter((m) => backText.toLowerCase().includes(m)).length;

    const hasVoterFrontDemographics = (t) => {
      const hasFather = t.includes("father's name") || t.includes('father name') || t.includes('पिता का नाम') || t.includes("husband's name") || t.includes('पति का नाम');
      const hasGender = t.includes('male') || t.includes('female') || t.includes('लिंग') || t.includes('gender');
      const hasDob = t.includes('dob') || t.includes('date of birth') || t.includes('जन्म तिथि') || t.includes('age') || t.includes('आयु');
      const hasHeader = t.includes('elector photo identity') || t.includes('मतदाता पहचान पत्र') || t.includes('elector name') || (t.includes('election') && t.includes('commission'));
      return hasFather || (hasGender && hasDob) || (hasHeader && (hasGender || hasDob));
    };

    const frontHasVoterFrontDemographics = hasVoterFrontDemographics(frontText.toLowerCase());
    const backHasVoterFrontDemographics = hasVoterFrontDemographics(backText.toLowerCase());

    const hasAnyVoterBackMarker =
      isVoterBackDocument(backText) ||
      backHasVoter ||
      backVoterBackMatches >= 1 ||
      (backText.toLowerCase().includes('address') && (backText.toLowerCase().includes('nirvachan') || backText.toLowerCase().includes('election') || backText.toLowerCase().includes('voter') || backText.toLowerCase().includes('epic') || backText.toLowerCase().includes('officer')));

    // Check if Back side was uploaded into Front slot
    if (frontText && (isVoterBackDocument(frontText) || frontVoterBackMatches >= 1 || (frontText.toLowerCase().includes('address') && !frontHasVoterFrontDemographics))) {
      const err = new Error('Voter ID (Back side) detected in Front side upload. Please upload the Front side of your Voter ID.');
      err.statusCode = 400;
      throw err;
    }

    // Check if Front side was uploaded into Back slot
    if (backText && (backHasVoterFrontDemographics || isVoterFrontDocument(backText)) && backVoterBackMatches === 0 && !isVoterBackDocument(backText)) {
      const err = new Error('Voter ID (Front side) detected in Back side upload. Please upload the Back side of your Voter ID.');
      err.statusCode = 400;
      throw err;
    }

    // 3. Authentic Voter ID Document Checks
    const hasFrontVoterDoc = frontHasVoter || isVoterFrontDocument(frontText) || frontHasVoterFrontDemographics;
    const hasBackVoterDoc = backHasVoter || hasAnyVoterBackMarker;

    if (!hasFrontVoterDoc && !hasBackVoterDoc && (frontText.trim().length >= 10 || backText.trim().length >= 10)) {
      const err = new Error('Invalid document detected. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    if (frontHasExtractableText && !hasFrontVoterDoc) {
      const err = new Error('Invalid document detected on Front side. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    if (backHasExtractableText && !hasBackVoterDoc) {
      const err = new Error('Invalid document detected on Back side. Only Voter ID card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Final verification checks
    if (!hasFrontVoterDoc) {
      const err = new Error('Please upload a valid Voter ID card (Front side). Only Voter ID card is accepted.');
      err.statusCode = 400;
      throw err;
    }

    if (!hasBackVoterDoc) {
      const err = new Error('Please upload a valid Voter ID card (Back side). Only Voter ID card is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }

  // ── 2. AADHAAR VALIDATION (Images & PDFs) ───────────────────────────────
  if (expectedType === 'aadhaar') {
    // 1. Strict Cross-Document Detection (MUST BE FIRST before blur / clarity or slot checks!)
    // Voter ID card detection (Front or Back)
    if (
      frontHasVoter ||
      backHasVoter ||
      isVoterDocument(frontText) ||
      isVoterDocument(backText) ||
      isVoterBackDocument(backText)
    ) {
      const err = new Error('Voter ID card detected. Only Aadhaar card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // PAN card detection (Front or Back)
    if (frontHasPan || backHasPan || isPanDocument(frontText) || isPanDocument(backText)) {
      const err = new Error('PAN card detected. Only Aadhaar card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Driving License detection (Front or Back)
    if (frontHasDl || backHasDl || isDlDocument(frontText) || isDlDocument(backText) || isDlBackDocument(backText)) {
      const err = new Error('Driving License detected. Only Aadhaar card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Passport detection (Front or Back)
    if (isPassportDocument(frontText) || isPassportDocument(backText)) {
      const err = new Error('Passport detected. Only Aadhaar card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Slot Position Checks
    const fNameAadhaar = (frontFilename || '').toLowerCase();
    const bNameAadhaar = (backFilename || '').toLowerCase();
    const isBackFilenameAadhaar = (str) => /(^|[^a-z0-9])(back|piche|rear|bck)($|[^a-z0-9])/i.test(str) || /[-_.]back[-_.]/i.test(str) || /aadhaar[-_\s]*back/i.test(str) || /aadhar[-_\s]*back/i.test(str);
    const isFrontFilenameAadhaar = (str) => /(^|[^a-z0-9])(front|aage|frnt)($|[^a-z0-9])/i.test(str) || /[-_.]front[-_.]/i.test(str) || /aadhaar[-_\s]*front/i.test(str) || /aadhar[-_\s]*front/i.test(str);

    if (fNameAadhaar && isBackFilenameAadhaar(fNameAadhaar) && !isFrontFilenameAadhaar(fNameAadhaar)) {
      const err = new Error('Aadhaar card (Back side) detected in Front side upload. Please upload the Front side of your Aadhaar card.');
      err.statusCode = 400;
      throw err;
    }
    if (bNameAadhaar && isFrontFilenameAadhaar(bNameAadhaar) && !isBackFilenameAadhaar(bNameAadhaar)) {
      const err = new Error('Aadhaar card (Front side) detected in Back side upload. Please upload the Back side of your Aadhaar card.');
      err.statusCode = 400;
      throw err;
    }

    if (frontText && isAadhaarBackDocument(frontText) && !isAadhaarFrontDocument(frontText)) {
      const err = new Error(
        'Aadhaar card (Back side) detected in Front side upload. Please upload the Front side of your Aadhaar card.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (backText && isAadhaarFrontDocument(backText) && !isAadhaarBackDocument(backText)) {
      const err = new Error(
        'Aadhaar card (Front side) detected in Back side upload. Please upload the Back side of your Aadhaar card.'
      );
      err.statusCode = 400;
      throw err;
    }

    // 3. Authentic Aadhaar Document Checks
    const hasFrontAadhaar = frontHasAadhaar || isAadhaarFrontDocument(frontText);
    const hasBackAadhaar = backHasAadhaar || isAadhaarBackDocument(backText);

    // If Back side is blurry or unreadable (low confidence or details couldn't be extracted)
    if (!backIsPdf && backBuffer) {
      if ((backRes.confidence > 0 && backRes.confidence < 35) || (backText.trim().length < 20 && !hasBackAadhaar)) {
        const err = new Error(
          'The uploaded Aadhaar card (Back side) image is blurry or unclear. Please upload a clear and sharp photo.'
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // If Front side is blurry or unreadable (low confidence or details couldn't be extracted)
    if (!frontIsPdf && frontBuffer) {
      if ((frontRes.confidence > 0 && frontRes.confidence < 35) || (frontText.trim().length < 20 && !hasFrontAadhaar)) {
        const err = new Error(
          'The uploaded Aadhaar card (Front side) image is blurry or unclear. Please upload a clear and sharp photo.'
        );
        err.statusCode = 400;
        throw err;
      }
    }

    // If both slots contain clear text but neither matches Aadhaar
    if (!hasFrontAadhaar && !hasBackAadhaar && (frontText.trim().length >= 10 || backText.trim().length >= 10)) {
      const err = new Error('Invalid document detected. Only Aadhaar card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // If Front has extractable text and is not Aadhaar Front (unclear / blurry or not authentic)
    if (frontHasExtractableText && !hasFrontAadhaar) {
      const err = new Error(
        'The uploaded Aadhaar card (Front side) image is blurry or unclear. Please upload a clear and sharp photo.'
      );
      err.statusCode = 400;
      throw err;
    }

    // If Back has extractable text and is not Aadhaar Back (unclear / blurry or not authentic)
    if (backHasExtractableText && !hasBackAadhaar) {
      const err = new Error(
        'The uploaded Aadhaar card (Back side) image is blurry or unclear. Please upload a clear and sharp photo.'
      );
      err.statusCode = 400;
      throw err;
    }

    // 4. Final verification checks
    if (!hasFrontAadhaar) {
      const err = new Error('The uploaded Aadhaar card (Front side) image is blurry or unclear. Please upload a clear and sharp photo.');
      err.statusCode = 400;
      throw err;
    }

    if (!hasBackAadhaar) {
      const err = new Error('The uploaded Aadhaar card (Back side) image is blurry or unclear. Please upload a clear and sharp photo.');
      err.statusCode = 400;
      throw err;
    }
  }

  // ── 3. DRIVING LICENSE VALIDATION (Images & PDFs) ───────────────────────
  if (expectedType === 'driving_license') {
    // 1. Cross-document rejection on front and back
    if (frontHasPan || backHasPan || isPanDocument(frontText) || isPanDocument(backText)) {
      const err = new Error('PAN card detected. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasAadhaar || backHasAadhaar || isAadhaarDocument(frontText) || isAadhaarDocument(backText)) {
      const err = new Error('Aadhaar card detected. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasVoter || backHasVoter || isVoterDocument(frontText) || isVoterDocument(backText)) {
      const err = new Error('Voter ID detected. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (isPassportDocument(frontText) || isPassportDocument(backText)) {
      const err = new Error('Passport detected. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // 0. Filename heuristic checks (e.g. "neha dl back.jpeg" vs "neha dl front.jpeg")
    const fName = (frontFilename || '').toLowerCase();
    const bName = (backFilename || '').toLowerCase();

    const isBackFilename = (str) =>
      /(^|[^a-z0-9])(back|piche|rear|bck)($|[^a-z0-9])/i.test(str) ||
      /[-_.]back[-_.]/i.test(str) ||
      /dl[-_\s]*back/i.test(str);

    const isFrontFilename = (str) =>
      /(^|[^a-z0-9])(front|aage|frnt)($|[^a-z0-9])/i.test(str) ||
      /[-_.]front[-_.]/i.test(str) ||
      /dl[-_\s]*front/i.test(str);

    if (fName && isBackFilename(fName) && !isFrontFilename(fName)) {
      const err = new Error('Driving License (Back side) detected in Front side upload. Please upload the Front side of your Driving License.');
      err.statusCode = 400;
      throw err;
    }

    if (bName && isFrontFilename(bName) && !isBackFilename(bName)) {
      const err = new Error('Driving License (Front side) detected in Back side upload. Please upload the Back side of your Driving License.');
      err.statusCode = 400;
      throw err;
    }

    // 2. Slot Position Checks
    const dlBackUniqueMarkers = [
      'emergency contact',
      'badge number',
      'badge issued',
      'invalid carriage',
      'hazardous validity',
      'hill validity',
      'form 7',
      'valid throughout india',
      'throughout india',
    ];
    const frontBackTableMatches = dlBackUniqueMarkers.filter((m) => frontText.toLowerCase().includes(m)).length;
    const backBackTableMatches = dlBackUniqueMarkers.filter((m) => backText.toLowerCase().includes(m)).length;

    const hasFrontIndicators = (t) => {
      const norm = t.toLowerCase().replace(/\s+/g, ' ');
      const hasHeader =
        norm.includes('indian union') ||
        norm.includes('union of india') ||
        norm.includes('driving licence') ||
        norm.includes('driving license') ||
        norm.includes('transport department') ||
        norm.includes('transport') ||
        norm.includes('issued by');
      const hasDlNum =
        /[a-z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}/i.test(t) ||
        /[a-z]{2}[0-9]{2}[ -]?[0-9]{11}/i.test(t) ||
        /\b[a-z]{2}[0-9]{2}\s?[0-9]{11}\b/i.test(t);
      const hasParent = t.includes('s/o') || t.includes('d/o') || t.includes('w/o') || t.includes('son of') || t.includes('daughter of') || t.includes('father');
      const hasDob = t.includes('dob') || t.includes('date of birth') || t.includes('d.o.b') || t.includes('birth:') || t.includes('जन्म तिथि');
      const hasName = t.includes('name:') || t.includes('name :');
      return hasHeader || hasDlNum || (hasParent && hasDob) || (hasName && (hasParent || hasDob));
    };

    const frontIsFront = hasFrontIndicators(frontText);
    const backIsFront = hasFrontIndicators(backText);

    const hasAnyDlBackMarker =
      isDlBackDocument(backText) ||
      backHasDl ||
      backBackTableMatches >= 1 ||
      backText.includes('endorsement') ||
      backText.includes('form 7') ||
      backText.includes('address') ||
      backText.includes('पता') ||
      backText.includes('rto');

    // Check if Back side was uploaded into Front slot
    if (frontText && !frontIsFront && (isDlBackDocument(frontText) || frontBackTableMatches >= 1)) {
      const err = new Error('Driving License (Back side) detected in Front side upload. Please upload the Front side of your Driving License.');
      err.statusCode = 400;
      throw err;
    }

    // Check if Front side was uploaded into Back slot
    if (backText && backIsFront && !isDlBackDocument(backText) && backBackTableMatches === 0 && !backText.toLowerCase().includes('address') && !backText.toLowerCase().includes('पता')) {
      const err = new Error('Driving License (Front side) detected in Back side upload. Please upload the Back side of your Driving License.');
      err.statusCode = 400;
      throw err;
    }

    // 3. Authentic Driving License Document Checks (For clear non-DL documents)
    const hasFrontDl = frontHasDl || isDlFrontDocument(frontText) || frontIsFront;
    const hasBackDl = backHasDl || hasAnyDlBackMarker;

    // If both slots contain clear text but neither matches Driving License
    if (!hasFrontDl && !hasBackDl && (frontText.trim().length >= 10 || backText.trim().length >= 10)) {
      const err = new Error('Invalid document detected. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Validate DL Front side only if sufficient text was extracted locally
    if (frontHasExtractableText && !hasFrontDl) {
      const err = new Error('Invalid document detected on Front side. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // Validate DL Back side only if sufficient text was extracted locally
    if (backHasExtractableText && !hasBackDl) {
      const err = new Error('Invalid document detected on Back side. Only Driving License is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }

    // 4. Final verification checks
    if (!hasFrontDl) {
      const err = new Error('Please upload a valid Driving License (Front side). Only Driving License is accepted.');
      err.statusCode = 400;
      throw err;
    }

    if (!hasBackDl) {
      const err = new Error('Please upload a valid Driving License (Back side). Only Driving License is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }

  // ── 4. PAN CARD VALIDATION (Images & PDFs) ──────────────────────────────
  if (expectedType === 'pan') {
    if (frontHasAadhaar || backHasAadhaar || isAadhaarDocument(frontText) || isAadhaarDocument(backText)) {
      const err = new Error('Aadhaar card detected. Only PAN card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasVoter || backHasVoter || isVoterDocument(frontText) || isVoterDocument(backText)) {
      const err = new Error('Voter ID detected. Only PAN card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasDl || backHasDl || isDlDocument(frontText) || isDlDocument(backText)) {
      const err = new Error('Driving License detected. Only PAN card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (isPassportDocument(frontText) || isPassportDocument(backText)) {
      const err = new Error('Passport detected. Only PAN card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
    if (frontHasExtractableText && !frontHasPan) {
      const err = new Error('Invalid document detected. Only PAN card is accepted for this verification. No other document is accepted.');
      err.statusCode = 400;
      throw err;
    }
  }
}

module.exports = {
  isPdfBuffer,
  recognizeText,
  isAadhaarDocument,
  isAadhaarFrontDocument,
  isAadhaarBackDocument,
  isVoterDocument,
  isVoterFrontDocument,
  isVoterBackDocument,
  isPanDocument,
  isDlDocument,
  isDlFrontDocument,
  isDlBackDocument,
  validateDocumentConsistency,
};
