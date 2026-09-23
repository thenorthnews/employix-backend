const axios = require('axios');
const FormData = require('form-data');
const logger = require('../../../../utils/logger');
const Identification = require('../../models/identification.model');

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
  const form = new FormData();
  form.append('documentFront', frontFile.buffer, {
    filename: frontFile.originalname || 'dl_front.jpg',
    contentType: frontFile.mimetype,
  });

  if (backFile) {
    form.append('documentBack', backFile.buffer, {
      filename: backFile.originalname || 'dl_back.jpg',
      contentType: backFile.mimetype,
    });
  }

  if (groupId) {
    form.append('groupId', String(groupId).trim());
  }
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
        timeout: 45000,
      }
    );
    dlData = response.data?.data || {};
    responseGroupId = response.data?.groupId;
  } catch (err) {
    logger.error('Setu DL OCR Gateway error', {
      correlationId,
      userId,
      statusCode: err.response?.status || 500,
      error: err.response?.data || err.message,
    });
    // Throw real third-party error so it is properly shown to the candidate
    throw err;
  }

  const rawDlNumber = String(dlData.licenseNumber || dlData.dlNumber || dlData.number || '').trim();
  const maskedDl =
    rawDlNumber.length > 4
      ? `${rawDlNumber.slice(0, 4)}******${rawDlNumber.slice(-4)}`
      : (rawDlNumber ? `******${rawDlNumber}` : null);

  // 4. Name Match Verification
  const dlName = (dlData.name || '').toLowerCase().trim();
  const userEnteredName = (candidateName || '').toLowerCase().trim();
  const isNameMatched = Boolean(
    !userEnteredName || !dlName || (dlName.includes(userEnteredName) || userEnteredName.includes(dlName))
  );

  // 5. Verification Status Decision
  let verificationStatus = 'verified';
  let failureReason = null;

  if (!rawDlNumber) {
    verificationStatus = 'failed';
    failureReason = 'DL details not found in image';
  } else if (!isNameMatched && candidateName) {
    verificationStatus = 'failed';
    failureReason = 'Name mismatch with Driving License';
  }

  const splitAddr = dlData.splitAddress || {};
  const fullAddress =
    dlData.address ||
    [splitAddr.streetAddress, splitAddr.city, splitAddr.district, splitAddr.state, splitAddr.pincode]
      .filter(Boolean)
      .join(', ') ||
    null;

  // 6. Identification Collection Upsert with purely dynamic data
  const savedData = await Identification.findOneAndUpdate(
    { userId, documentType: 'driving_license' },
    {
      $set: {
        provider: 'setu_dl_ocr',
        correlationId,
        groupId: responseGroupId || groupId || null,
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
        address: {
          fullAddress,
          streetAddress: splitAddr.streetAddress || null,
          city: splitAddr.city || null,
          district: splitAddr.district || null,
          state: splitAddr.state || null,
          pincode: splitAddr.pincode || null,
        },
        isScanned: Boolean(dlData.isScanned !== undefined ? dlData.isScanned : true),
        verificationStatus,
        failureReason,
        verifiedAt: verificationStatus === 'verified' ? new Date() : null,
        consentGiven: true,
        consentTimestamp: new Date(),
      },
    },
    { upsert: true, new: true }
  );

  return savedData;
};

module.exports = { extractDlOcrData };
