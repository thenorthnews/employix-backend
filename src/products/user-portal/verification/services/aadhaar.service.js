const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');
const Identification = require('../../models/identification.model');
const User = require('../../../../common/users/user.model');
const Qualification = require('../../models/qualification.model');
const Certification = require('../../models/certification.model');
const {
  maskDocumentNumber,
  extractFormattedAddress,
  parseDocumentDob,
  standardizeGender,
  generateSafeGroupId,
} = require('../../../../helpers/documentHelper');
const { validateDocumentConsistency } = require('../../../../helpers/documentClassifier');
const logger = require('../../../../utils/logger');

const bufferToStream = (buffer) => {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
};

/**
 * Setu Aadhaar OCR Gateway Call
 */
const extractAadhaarOcr = async ({ frontFile, documentFront, backFile, documentBack, groupId, correlationId }) => {
  const actualFront = frontFile || (Array.isArray(documentFront) ? documentFront[0] : documentFront);
  const actualBack = backFile || (Array.isArray(documentBack) ? documentBack[0] : documentBack);

  if (!actualFront || !actualFront.buffer) {
    throw new Error('Front document image is required for Aadhaar OCR');
  }

  const formData = new FormData();

  formData.append('documentFront', bufferToStream(actualFront.buffer), {
    filename: actualFront.originalname || 'front.png',
    contentType: actualFront.mimetype || 'image/png',
    knownLength: actualFront.buffer.length,
  });

  if (actualBack && actualBack.buffer) {
    formData.append('documentBack', bufferToStream(actualBack.buffer), {
      filename: actualBack.originalname || 'back.png',
      contentType: actualBack.mimetype || 'image/png',
      knownLength: actualBack.buffer.length,
    });
  }

  formData.append('groupId', groupId);

  const targetUrl = `${process.env.SETU_BASE_URL || 'https://dg-sandbox.setu.co'}/api/sync/aadhaar/ocr`;

  logger.info('Calling Setu Aadhaar OCR Gateway', {
    correlationId,
    groupId,
    targetUrl,
    hasBackFile: Boolean(backFile),
  });

  try {
    const response = await axios.post(targetUrl, formData, {
      headers: {
        ...formData.getHeaders(),
        'x-client-id': process.env.SETU_CLIENT_ID,
        'x-client-secret': process.env.SETU_CLIENT_SECRET,
        'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 45000,
    });

    return response.data;
  } catch (error) {
    const rawMsg =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      (typeof error.response?.data?.error === 'string' ? error.response.data.error : null) ||
      error.message;

    logger.error('Setu Aadhaar OCR Gateway error', {
      correlationId,
      groupId,
      statusCode: error.response?.status || 500,
      gatewayResponse: error.response?.data || error.message,
    });

    let friendlyMsg = rawMsg;
    const lower = String(rawMsg).toLowerCase();
    if (
      lower.includes('non compliant') ||
      lower.includes('quality standard') ||
      lower.includes('not compliant') ||
      lower.includes('document_quality')
    ) {
      friendlyMsg = 'Uploaded document is not a valid Aadhaar card. Please upload a clear photo of your original Aadhaar card (Front & Back).';
    }

    const err = new Error(friendlyMsg || 'Invalid Aadhaar card. Please upload a valid Aadhaar card.');
    err.statusCode = 400;
    throw err;
  }
};

/**
 * Save / Update Aadhaar Record in MongoDB
 */
const saveAadhaarRecord = async ({
  userId,
  ocrData,
  requestId,
  groupId,
  consentPurpose,
  correlationId,
}) => {
  const rawDocNumber = ocrData.aadhaarNumber || ocrData.documentNumber || ocrData.number;
  const maskedNumber = maskDocumentNumber(rawDocNumber);
  const formattedAddressText = extractFormattedAddress(ocrData.address);
  const parsedDob = parseDocumentDob(ocrData.dob);
  const standardizedGender = standardizeGender(ocrData.gender);

  const split = typeof ocrData.address === 'object' && ocrData.address !== null ? ocrData.address : {};

  const addressPayload = {
    fullAddress: formattedAddressText,
    streetAddress: split.street || split.streetAddress || null,
    city: split.city || null,
    district: split.district || null,
    state: split.state || null,
    pincode: split.pincode || split.postalCode || null,
  };

  const updatePayload = {
    userId,
    documentType: 'aadhaar',
    verificationStatus: 'verified',
    provider: 'setu',
    requestId: requestId || null,
    groupId: groupId || null,
    correlationId: correlationId || null,
    maskedDocumentNumber: maskedNumber,
    name: ocrData.name ? ocrData.name.trim() : null,
    dob: parsedDob,
    gender: standardizedGender,
    address: addressPayload,
    score: ocrData.confidenceScore ? Number(ocrData.confidenceScore) : null,
    consentGiven: true,
    consentVersion: 'v1.0',
    consentTimestamp: new Date(),
    consentPurpose: consentPurpose || 'Identity verification for onboarding',
    verifiedAt: new Date(),
  };

  return await Identification.findOneAndUpdate(
    { userId, documentType: 'aadhaar' },
    updatePayload,
    { upsert: true, new: true }
  );
};

/**
 * Orchestrator Flow: Aadhaar OCR Document Verification (100% Dynamic)
 */
const processAadhaarVerificationFlow = async ({
  userId,
  frontFile,
  documentFront,
  backFile,
  documentBack,
  groupId,
  consentPurpose,
  correlationId,
}) => {
  const actualFront = frontFile || (Array.isArray(documentFront) ? documentFront[0] : documentFront);
  const actualBack = backFile || (Array.isArray(documentBack) ? documentBack[0] : documentBack);

  if (!actualFront || !actualFront.buffer) {
    const error = new Error('Please upload a valid Aadhaar card (Front side). Only Aadhaar card is accepted.');
    error.statusCode = 400;
    throw error;
  }
  if (!actualBack || !actualBack.buffer) {
    const error = new Error('Please upload a valid Aadhaar card (Back side). Only Aadhaar card is accepted.');
    error.statusCode = 400;
    throw error;
  }

  // Pre-validate that uploaded images match Aadhaar
  await validateDocumentConsistency({
    expectedType: 'aadhaar',
    frontBuffer: actualFront.buffer,
    backBuffer: actualBack.buffer,
  });

  const existingRecord = await Identification.findOne(
    { userId, groupId: { $exists: true, $ne: null } },
    { groupId: 1 }
  ).lean();

  const finalGroupId = groupId || existingRecord?.groupId || generateSafeGroupId();

  logger.info('Starting Aadhaar OCR verification workflow', {
    correlationId,
    userId,
    groupId: finalGroupId,
  });

  // Call Setu OCR Gateway directly (throws on any error / bad request)
  const gatewayResponse = await extractAadhaarOcr({
    frontFile: actualFront,
    backFile: actualBack,
    groupId: finalGroupId,
    correlationId,
  });

  const ocrData = gatewayResponse?.data;
  if (!ocrData || (!ocrData.aadhaarNumber && !ocrData.documentNumber && !ocrData.name)) {
    throw new Error('Setu Gateway: Could not extract valid Aadhaar details from the image. Please upload a clear photo.');
  }

  const savedRecord = await saveAadhaarRecord({
    userId,
    ocrData,
    requestId: gatewayResponse?.requestId || gatewayResponse?.id || 'req_' + Date.now(),
    groupId: finalGroupId,
    consentPurpose,
    correlationId,
  });

  logger.info('Aadhaar OCR verification workflow successfully completed', {
    correlationId,
    userId,
    recordId: savedRecord._id,
    groupId: finalGroupId,
  });

  return {
    verificationStatus: savedRecord.verificationStatus,
    maskedDocumentNumber: savedRecord.maskedDocumentNumber,
    name: savedRecord.name,
    dob: savedRecord.dob,
    gender: savedRecord.gender,
    address: savedRecord.address,
    verifiedAt: savedRecord.verifiedAt,
  };
};

module.exports = {
  extractAadhaarOcr,
  saveAadhaarRecord,
  processAadhaarVerificationFlow,
};
