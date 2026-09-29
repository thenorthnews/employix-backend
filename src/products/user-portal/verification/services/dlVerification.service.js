const axios = require('axios');
const FormData = require('form-data');
const logger = require('../../../../utils/logger');
const Identification = require('../../models/identification.model');
const User = require('../../../../common/users/user.model');
const { parseStructuredAddress, validateDlNameMatch } = require('../../../../helpers/documentHelper');
const { validateDocumentConsistency } = require('../../../../helpers/documentClassifier');

const generateSafeGroupId = () => `grp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

const parseDateString = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const parsed = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
  return isNaN(parsed.getTime()) ? null : parsed;
};

const extractDlOcrData = async ({
  userId,
  frontFile,
  backFile = null,
  candidateName = '',
  groupId = null,
  correlationId = 'N/A',
}) => {
  if (!frontFile || !frontFile.buffer) {
    const error = new Error('Please upload a valid Driving License (Front side). Only Driving License is accepted.');
    error.statusCode = 400;
    throw error;
  }

  if (!backFile || !backFile.buffer) {
    const error = new Error('Please upload a valid Driving License (Back side). Only Driving License is accepted.');
    error.statusCode = 400;
    throw error;
  }
  await validateDocumentConsistency({
    expectedType: 'driving_license',
    frontBuffer: frontFile.buffer,
    backBuffer: backFile.buffer,
    frontFilename: frontFile.originalname || '',
    backFilename: backFile.originalname || '',
  });

  const existingRecord = await Identification.findOne(
    { userId, groupId: { $exists: true, $ne: null } },
    { groupId: 1 }
  ).lean();

  const activeGroupId = groupId || existingRecord?.groupId || generateSafeGroupId();

  const form = new FormData();
  form.append('groupId', String(activeGroupId).trim());
  form.append('documentFront', frontFile.buffer, {
    filename: frontFile.originalname || 'dl_front.jpg',
    contentType: frontFile.mimetype || 'image/jpeg',
  });

  form.append('documentBack', backFile.buffer, {
    filename: backFile.originalname || 'dl_back.jpg',
    contentType: backFile.mimetype || 'image/jpeg',
  });

  let dlData = {};
  let responseGroupId = null;

  try {
    const targetBaseUrl = process.env.SETU_BASE_URL || 'https://dg-sandbox.setu.co';
    const response = await axios.post(
      `${targetBaseUrl}/api/sync/dl/ocr`,
      form,
      {
        headers: {
          ...form.getHeaders(),
          'x-client-id': process.env.SETU_CLIENT_ID,
          'x-client-secret': process.env.SETU_CLIENT_SECRET,
          'x-product-instance-id': process.env.SETU_DL_INSTANCE_ID || process.env.SETU_PRODUCT_INSTANCE_ID,
          'x-correlation-id': correlationId,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 45000,
      }
    );
    dlData = response.data?.data || {};
    responseGroupId = response.data?.groupId;
  } catch (err) {
    const dynamicMsg =
      err.response?.data?.message ||
      err.response?.data?.error?.message ||
      (typeof err.response?.data?.error === 'string' ? err.response.data.error : null) ||
      err.response?.data?.error?.detail ||
      err.response?.data?.detail ||
      err.message;

    logger.error('Setu DL OCR Gateway error', {
      correlationId,
      userId,
      statusCode: err.response?.status || err.statusCode || 500,
      error: err.response?.data || err.message,
    });

    let friendlyMsg = dynamicMsg;
    const lower = String(dynamicMsg).toLowerCase();
    if (
      lower.includes('non compliant') ||
      lower.includes('quality standard') ||
      lower.includes('not compliant') ||
      lower.includes('document_quality') ||
      lower.includes('blur') ||
      lower.includes('unclear') ||
      lower.includes('blurry')
    ) {
      if (lower.includes('blur') || lower.includes('unclear') || lower.includes('blurry')) {
        friendlyMsg = 'The uploaded Driving License image is blurry or unclear. Please upload a clear and sharp photo.';
      } else if (lower.includes('front') || lower.includes('documentfront')) {
        friendlyMsg = 'Please upload a valid Driving License (Front side). Only Driving License is accepted.';
      } else if (lower.includes('back') || lower.includes('documentback')) {
        friendlyMsg = 'Please upload a valid Driving License (Back side). Only Driving License is accepted.';
      } else {
        friendlyMsg = 'Uploaded document is not a valid Driving License. Please upload a clear photo of your original Driving License (Front & Back).';
      }
    }

    const error = new Error(friendlyMsg || 'Invalid Driving License. Please upload a valid Driving License.');
    error.statusCode = err.statusCode && err.statusCode < 500 ? err.statusCode : 400;
    throw error;
  }

  const rawDlNumber = String(dlData.licenseNumber || dlData.dlNumber || dlData.number || '').trim();
  if (!rawDlNumber) {
    const error = new Error('Driving License scan failed. The document image may be blurry, cropped, or unreadable. Please upload a clear photo of your Driving License.');
    error.statusCode = 400;
    throw error;
  }

  // Validate Name Matching against Registered Profile Name
  const currentUser = await User.findById(userId).select('name email');
  if (currentUser?.name && dlData?.name) {
    const nameCheck = validateDlNameMatch(currentUser.name, dlData.name);
    if (!nameCheck.isMatch) {
      logger.warn('Driving License verification rejected due to name mismatch', {
        userId,
        registeredName: currentUser.name,
        dlName: dlData.name,
        correlationId,
      });
      const error = new Error(nameCheck.reason);
      error.statusCode = 400;
      error.isNameMismatch = true;
      throw error;
    }
  }

  const maskedDl =
    rawDlNumber.length > 4
      ? `${rawDlNumber.slice(0, 4)}******${rawDlNumber.slice(-4)}`
      : `******${rawDlNumber}`;


  const addressPayload = parseStructuredAddress(dlData.address, dlData.splitAddress);

  // 5. Identification Collection Upsert with purely dynamic data
  const savedData = await Identification.findOneAndUpdate(
    { userId, documentType: 'driving_license' },
    {
      $set: {
        provider: 'setu_dl_ocr',
        correlationId,
        groupId: responseGroupId || activeGroupId || null,
        maskedDocumentNumber: maskedDl,
        name: dlData.name ? dlData.name.trim() : (candidateName || null),
        dob: parseDateString(dlData.dob) || null,
        fatherOrHusbandName: dlData.fatherOrHusbandName || null,
        dateOfExpiry: parseDateString(dlData.dateOfExpiry) || null,
        vehicleTypes: Array.isArray(dlData.type) ? dlData.type : (dlData.type ? [dlData.type] : []),
        validity: {
          nonTransport: parseDateString(dlData.validity?.NT) || null,
          transport: parseDateString(dlData.validity?.T) || null,
        },
        address: addressPayload,
        isScanned: Boolean(dlData.isScanned !== undefined ? dlData.isScanned : true),
        verificationStatus: 'verified',
        failureReason: null,
        verifiedAt: new Date(),
        consentGiven: true,
        consentTimestamp: new Date(),
      },
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

  return savedData;
};

module.exports = { extractDlOcrData };
