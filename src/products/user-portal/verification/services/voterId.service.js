const axios = require('axios');
const FormData = require('form-data');
const { Readable } = require('stream');
const Identification = require('../../models/identification.model');
const User = require('../../../../common/users/user.model');
const logger = require('../../../../utils/logger');
const {
  extractFormattedAddress,
  parseStructuredAddress,
  parseDocumentDob,
  standardizeGender,
  generateSafeGroupId,
  maskVoterId,
  getGatewayHeaders,
} = require('../../../../helpers/documentHelper');
const {
  validateDocumentConsistency,
  isPdfBuffer,
  extractImagesFromPdfBuffer,
} = require('../../../../helpers/documentClassifier');

const bufferToStream = (buffer) => Readable.from(buffer);

/**
 * Direct Voter ID Verification (API lookup)
 */
const verifyVoterIdRecord = async ({ userId, number, consentPurpose, correlationId }) => {
  const cleanNumber = (number || '').trim().toUpperCase();
  const maskedNumber = maskVoterId(cleanNumber);

  // Preserve existing groupId across user documents
  const existingRecord = await Identification.findOne(
    { userId, groupId: { $exists: true, $ne: null } },
    { groupId: 1 }
  ).lean();

  const activeGroupId = existingRecord?.groupId || generateSafeGroupId();
  const targetUrl = `${process.env.SETU_BASE_URL || 'https://dg.setu.co'}/api/sync/voter-id/verify`;

  const requestPayload = {
    groupId: activeGroupId,
    number: cleanNumber,
  };

  logger.info('Initiating Setu Voter ID Gateway Call', {
    correlationId,
    userId,
    groupId: activeGroupId,
    endpoint: '/api/sync/voter-id/verify',
    maskedNumber,
  });

  try {
    const response = await axios.post(targetUrl, requestPayload, {
      headers: getGatewayHeaders(),
      timeout: 30000,
    });

    const responseData = response.data;

    if (!responseData?.data || responseData?.message === 'Voter ID number not found') {
      const dynamicMsg =
        responseData?.message ||
        responseData?.error?.message ||
        (typeof responseData?.error === 'string' ? responseData.error : null) ||
        'Voter ID number not found';
      const error = new Error(dynamicMsg);
      error.statusCode = 404;
      throw error;
    }

    const voterData = responseData.data;
    const addressPayload = parseStructuredAddress(voterData.address, voterData.splitAddress);
    const parsedDob = parseDocumentDob(voterData.dob);
    const standardizedGender = standardizeGender(voterData.gender);

    const updatedRecord = await Identification.findOneAndUpdate(
      { userId, documentType: 'voter_id' },
      {
        userId,
        documentType: 'voter_id',
        verificationStatus: 'verified',
        provider: 'setu_voter_id',
        groupId: activeGroupId,
        correlationId: correlationId || null,
        maskedDocumentNumber: maskedNumber,
        name: voterData.name ? voterData.name.trim() : null,
        dob: parsedDob,
        age: voterData.age ? Number(voterData.age) : null,
        gender: standardizedGender,
        address: addressPayload,
        consentGiven: true,
        consentVersion: 'v1.0',
        consentTimestamp: new Date(),
        consentPurpose: consentPurpose || 'Address and identity verification for employee onboarding',
        verifiedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Sync to User collection
    const existingUser = await User.findById(userId);
    const userUpdates = {};
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

    logger.info('Voter ID details successfully persisted', {
      correlationId,
      userId,
      recordId: updatedRecord._id,
      groupId: activeGroupId,
    });

    return {
      verificationStatus: updatedRecord.verificationStatus,
      maskedDocumentNumber: updatedRecord.maskedDocumentNumber,
      name: updatedRecord.name,
      dob: updatedRecord.dob,
      age: updatedRecord.age,
      gender: updatedRecord.gender,
      address: updatedRecord.address,
      currentAddress: updatedRecord.address,
      groupId: updatedRecord.groupId,
      verifiedAt: updatedRecord.verifiedAt,
    };
  } catch (error) {
    const dynamicMsg =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      (typeof error.response?.data?.error === 'string' ? error.response.data.error : null) ||
      error.response?.data?.error?.detail ||
      error.response?.data?.detail ||
      error.message;

    logger.error('Setu Voter ID Gateway error', {
      correlationId,
      userId,
      statusCode: error.response?.status || error.statusCode || 500,
      error: error.response?.data || error.message,
    });

    if (dynamicMsg) {
      error.message = dynamicMsg;
    }
    throw error;
  }
};

/**
 * Multipart Voter ID OCR Extraction
 */
const extractVoterOcrData = async ({ userId, frontFile, backFile, consentPurpose, correlationId }) => {
  const actualFront = Array.isArray(frontFile) ? frontFile[0] : frontFile;
  const actualBack = Array.isArray(backFile) ? backFile[0] : backFile;

  if (!actualFront || !actualFront.buffer) {
    const err = new Error('Please upload a valid Voter ID card (Front side). Only Voter ID card is accepted.');
    err.statusCode = 400;
    throw err;
  }

  if (!actualBack || !actualBack.buffer) {
    const err = new Error('Please upload a valid Voter ID card (Back side). Only Voter ID card is accepted.');
    err.statusCode = 400;
    throw err;
  }

  // Pre-validate that uploaded images match Voter ID and not Aadhaar/PAN/DL/baby photos
  await validateDocumentConsistency({
    expectedType: 'voter_id',
    frontBuffer: actualFront.buffer,
    backBuffer: actualBack.buffer,
    frontFilename: actualFront.originalname || '',
    backFilename: actualBack.originalname || '',
  });

  const existingRecord = await Identification.findOne(
    { userId, groupId: { $exists: true, $ne: null } },
    { groupId: 1 }
  ).lean();

  const activeGroupId = existingRecord?.groupId || generateSafeGroupId();
  const targetUrl = `${process.env.SETU_BASE_URL || 'https://dg-sandbox.setu.co'}/api/sync/voter-id/ocr`;

  let frontBuffer = actualFront.buffer;
  let frontName = actualFront.originalname || 'voter_front.jpg';
  let frontMime = actualFront.mimetype || 'image/jpeg';

  if (isPdfBuffer(frontBuffer)) {
    const imgs = extractImagesFromPdfBuffer(frontBuffer);
    if (imgs.length > 0) {
      frontBuffer = imgs[0];
      frontName = 'voter_front.jpg';
      frontMime = 'image/jpeg';
    }
  }

  let backBuffer = actualBack?.buffer;
  let backName = actualBack?.originalname || 'voter_back.jpg';
  let backMime = actualBack?.mimetype || 'image/jpeg';

  if (backBuffer && isPdfBuffer(backBuffer)) {
    const imgs = extractImagesFromPdfBuffer(backBuffer);
    if (imgs.length > 0) {
      backBuffer = imgs[0];
      backName = 'voter_back.jpg';
      backMime = 'image/jpeg';
    }
  }

  const form = new FormData();
  form.append('groupId', activeGroupId);

  form.append('documentFront', frontBuffer, {
    filename: frontName,
    contentType: frontMime,
  });

  if (backBuffer) {
    form.append('documentBack', backBuffer, {
      filename: backName,
      contentType: backMime,
    });
  }

  logger.info('Calling Setu Voter ID OCR Gateway', {
    correlationId,
    userId,
    groupId: activeGroupId,
    endpoint: '/api/sync/voter-id/ocr',
    hasBackSide: Boolean(actualBack),
  });

  try {
    const response = await axios.post(targetUrl, form, {
      headers: {
        ...form.getHeaders(),
        'x-client-id': process.env.SETU_CLIENT_ID,
        'x-client-secret': process.env.SETU_CLIENT_SECRET,
        'x-product-instance-id': process.env.SETU_VOTER_INSTANCE_ID || process.env.SETU_PRODUCT_INSTANCE_ID,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 45000,
    });

    const ocrPayload = response.data;
    const ocrData = ocrPayload?.data;

    if (!ocrData || (!ocrData.epicNumber && !ocrData.voterIdNumber && !ocrData.number && !ocrData.name && !ocrData.idNumber)) {
      const dynamicErrMsg =
        ocrPayload?.message ||
        ocrPayload?.error?.message ||
        (typeof ocrPayload?.error === 'string' ? ocrPayload.error : null) ||
        'Setu Gateway: Could not extract valid Voter ID card details from the image. Please upload a clear photo.';
      const error = new Error(dynamicErrMsg);
      error.statusCode = 400;
      throw error;
    }

    const rawCardNumber = ocrData.epicNumber || ocrData.voterIdNumber || ocrData.number || ocrData.idNumber || ocrData.voter_id;
    const maskedNumber = rawCardNumber ? maskVoterId(rawCardNumber) : null;

    const addressPayload = parseStructuredAddress(ocrData.address, ocrData.splitAddress);
    const parsedDob = ocrData.dob ? parseDocumentDob(ocrData.dob) : null;
    const standardizedGender = ocrData.gender ? standardizeGender(ocrData.gender) : null;

    const updatedRecord = await Identification.findOneAndUpdate(
      { userId, documentType: 'voter_id' },
      {
        userId,
        documentType: 'voter_id',
        verificationStatus: 'verified',
        provider: 'setu_voter_ocr',
        requestId: ocrPayload.id || null,
        groupId: activeGroupId,
        correlationId: correlationId || null,
        maskedDocumentNumber: maskedNumber,
        name: ocrData.name ? ocrData.name.trim() : null,
        dob: parsedDob,
        age: ocrData.age ? Number(ocrData.age) : null,
        gender: standardizedGender,
        address: addressPayload,
        consentGiven: true,
        consentVersion: 'v1.0',
        consentTimestamp: new Date(),
        consentPurpose: consentPurpose || 'Address and identity verification for employee onboarding',
        verifiedAt: new Date(),
      },
      { upsert: true, new: true }
    );

    // Sync to User collection
    const existingUser = await User.findById(userId);
    const userUpdates = {};
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

    logger.info('Voter ID OCR processed and saved', {
      correlationId,
      userId,
      recordId: updatedRecord._id,
      groupId: activeGroupId,
    });

    return {
      verificationStatus: updatedRecord.verificationStatus,
      maskedDocumentNumber: updatedRecord.maskedDocumentNumber,
      name: updatedRecord.name,
      dob: updatedRecord.dob,
      age: updatedRecord.age,
      gender: updatedRecord.gender,
      address: updatedRecord.address,
      currentAddress: updatedRecord.address,
      groupId: updatedRecord.groupId,
      verifiedAt: updatedRecord.verifiedAt,
    };
  } catch (error) {
    const dynamicMsg =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      (typeof error.response?.data?.error === 'string' ? error.response.data.error : null) ||
      error.response?.data?.error?.detail ||
      error.response?.data?.detail ||
      error.message;

    logger.error('Setu Voter ID OCR Gateway error', {
      correlationId,
      userId,
      statusCode: error.response?.status || error.statusCode || 500,
      error: error.response?.data || error.message,
    });

    let friendlyMsg = dynamicMsg;
    const lower = String(dynamicMsg).toLowerCase();
    if (
      lower.includes('non compliant') ||
      lower.includes('quality standard') ||
      lower.includes('not compliant') ||
      lower.includes('document_quality')
    ) {
      friendlyMsg = 'Uploaded document is not a valid Voter ID card. Please upload a clear photo of your original Voter ID card (Front & Back).';
    }

    const err = new Error(friendlyMsg || 'Invalid Voter ID card. Please upload a valid Voter ID card.');
    err.statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 400;
    throw err;
  }
};

module.exports = {
  verifyVoterIdRecord,
  extractVoterOcrData,
};
