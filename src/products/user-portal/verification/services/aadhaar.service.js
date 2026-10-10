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
  parseStructuredAddress,
  parseDocumentDob,
  standardizeGender,
  generateSafeGroupId,
  validateAadhaarNameMatch,
} = require('../../../../helpers/documentHelper');
const { validateDocumentConsistency, isPdfBuffer, extractImagesFromPdfBuffer } = require('../../../../helpers/documentClassifier');
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

  let frontBuffer = actualFront.buffer;
  let frontName = actualFront.originalname || 'front.jpg';
  let frontMime = actualFront.mimetype || 'image/jpeg';

  if (isPdfBuffer(frontBuffer)) {
    const imgs = extractImagesFromPdfBuffer(frontBuffer);
    if (imgs.length > 0) {
      frontBuffer = imgs[0];
      frontName = 'front.jpg';
      frontMime = 'image/jpeg';
    }
  }

  let backBuffer = actualBack?.buffer;
  let backName = actualBack?.originalname || 'back.jpg';
  let backMime = actualBack?.mimetype || 'image/jpeg';

  if (backBuffer && isPdfBuffer(backBuffer)) {
    const imgs = extractImagesFromPdfBuffer(backBuffer);
    if (imgs.length > 0) {
      backBuffer = imgs[0];
      backName = 'back.jpg';
      backMime = 'image/jpeg';
    }
  }

  const formData = new FormData();

  formData.append('documentFront', bufferToStream(frontBuffer), {
    filename: frontName,
    contentType: frontMime,
    knownLength: frontBuffer.length,
  });

  if (backBuffer) {
    formData.append('documentBack', bufferToStream(backBuffer), {
      filename: backName,
      contentType: backMime,
      knownLength: backBuffer.length,
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

    if (response.data?.status === 'failed' || response.data?.error) {
      const setuMsg =
        response.data?.error?.message ||
        response.data?.error?.detail ||
        response.data?.message ||
        (typeof response.data?.error === 'string' ? response.data.error : null) ||
        JSON.stringify(response.data?.error || response.data);
      const err = new Error(setuMsg || 'Setu Aadhaar verification failed');
      err.statusCode = 400;
      err.isSetuError = true;
      err.setuData = response.data;
      throw err;
    }

    return response.data;
  } catch (error) {
    if (error.isSetuError) throw error;

    const statusCode = error.response?.status || 500;
    const setuResponseData = error.response?.data;

    logger.error('Setu Aadhaar OCR Gateway error', {
      correlationId,
      groupId,
      statusCode,
      gatewayResponse: setuResponseData || error.message,
    });

    let setuErrorMessage = '';
    if (setuResponseData) {
      if (typeof setuResponseData === 'string') {
        setuErrorMessage = setuResponseData;
      } else if (setuResponseData.error) {
        if (typeof setuResponseData.error === 'string') {
          setuErrorMessage = setuResponseData.error;
        } else if (typeof setuResponseData.error === 'object') {
          setuErrorMessage =
            setuResponseData.error.message ||
            setuResponseData.error.detail ||
            setuResponseData.error.description ||
            setuResponseData.error.code ||
            JSON.stringify(setuResponseData.error);
        }
      } else if (setuResponseData.message) {
        setuErrorMessage = setuResponseData.message;
        if (setuResponseData.detail) {
          setuErrorMessage += `: ${setuResponseData.detail}`;
        }
      } else if (setuResponseData.detail) {
        setuErrorMessage = setuResponseData.detail;
      } else if (Array.isArray(setuResponseData.errors) && setuResponseData.errors.length > 0) {
        setuErrorMessage = setuResponseData.errors
          .map((e) => e.message || e.detail || (typeof e === 'string' ? e : JSON.stringify(e)))
          .join(', ');
      } else {
        setuErrorMessage = JSON.stringify(setuResponseData);
      }
    } else {
      setuErrorMessage = error.message || 'Setu gateway error';
    }

    const lowerMsg = String(setuErrorMessage).toLowerCase();
    let finalMessage = setuErrorMessage;
    if (lowerMsg.includes('blur') || lowerMsg.includes('unclear')) {
      finalMessage = 'The uploaded Aadhaar card image is blurry or unclear. Please upload a clear and sharp photo.';
    } else if (lowerMsg.includes('crop') || lowerMsg.includes('cut off') || lowerMsg.includes('corner')) {
      finalMessage = 'The uploaded Aadhaar card image appears cropped or cut off. Please upload full card showing all 4 corners.';
    } else if (lowerMsg.includes('unsupported') || lowerMsg.includes('invalid_document') || lowerMsg.includes('not compliant') || lowerMsg.includes('non compliant')) {
      finalMessage = 'Uploaded document is not a valid Aadhaar card. Only authentic Aadhaar card is accepted. No other document is accepted.';
    }

    const err = new Error(finalMessage);
    err.statusCode = statusCode;
    err.isSetuError = true;
    err.setuData = setuResponseData;
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
  const addressPayload = parseStructuredAddress(ocrData.address, ocrData.splitAddress);
  const parsedDob = parseDocumentDob(ocrData.dob);
  const standardizedGender = standardizeGender(ocrData.gender);

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

  const savedRecord = await Identification.findOneAndUpdate(
    { userId, documentType: 'aadhaar' },
    updatePayload,
    { upsert: true, new: true }
  );

  // Sync to User collection
  const existingUser = await User.findById(userId);
  const userUpdates = {
    aadhaarStatus: 1,
  };
  if (ocrData.name && ocrData.name.trim()) {
    userUpdates.name = ocrData.name.trim();
  }
  if (!existingUser?.currentAddress?.fullAddress && addressPayload?.fullAddress) {
    userUpdates.currentAddress = addressPayload;
  }
  if (!existingUser?.address && addressPayload?.fullAddress) {
    userUpdates.address = addressPayload.fullAddress;
    userUpdates.city = addressPayload.city || '';
    userUpdates.state = addressPayload.state || '';
    userUpdates.pincode = addressPayload.pincode || '';
  }
  await User.findByIdAndUpdate(userId, { $set: userUpdates });

  return savedRecord;
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
    const error = new Error('Please upload a valid Aadhaar card (Front side). Front image is required.');
    error.statusCode = 400;
    throw error;
  }

  if (!actualBack || !actualBack.buffer) {
    const error = new Error('Please upload a valid Aadhaar card (Back side). Back image is required.');
    error.statusCode = 400;
    throw error;
  }

  // Pre-validate that uploaded images match Aadhaar (Front in front, Back in back, not identical, not other doc, not blur, not crop)
  await validateDocumentConsistency({
    expectedType: 'aadhaar',
    frontBuffer: actualFront.buffer,
    backBuffer: actualBack.buffer,
    frontFilename: actualFront.originalname || '',
    backFilename: actualBack.originalname || '',
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
    const errorMsg =
      ocrData && ocrData.isScanned === false
        ? 'Aadhaar OCR scan failed. The document image may be blurry, cropped, or unreadable. Please upload a clear photo of your Aadhaar card.'
        : 'Could not extract valid Aadhaar details from the image. Please upload a clear, sharp photo.';
    const error = new Error(errorMsg);
    error.statusCode = 400;
    error.isSetuError = true;
    throw error;
  }

  // Validate Name Matching against Registered Profile Name
  const currentUser = await User.findById(userId).select('name email');
  if (currentUser?.name && ocrData?.name) {
    const nameCheck = validateAadhaarNameMatch(currentUser.name, ocrData.name);
    if (!nameCheck.isMatch) {
      logger.warn('Aadhaar verification rejected due to name mismatch', {
        userId,
        registeredName: currentUser.name,
        aadhaarName: ocrData.name,
        correlationId,
      });
      const error = new Error(nameCheck.reason);
      error.statusCode = 400;
      error.isNameMismatch = true;
      throw error;
    }
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
    currentAddress: savedRecord.address,
    verifiedAt: savedRecord.verifiedAt,
  };
};

module.exports = {
  extractAadhaarOcr,
  saveAadhaarRecord,
  processAadhaarVerificationFlow,
};
