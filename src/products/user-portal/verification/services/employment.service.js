const axios = require('axios');
const logger = require('../../../../utils/logger');
const EmploymentVerification = require('../../models/employmentVerification.model');
const { tagEmploymentRecordsWithCurrent } = require('../helpers/epfoEmploymentHelper');

const SETU_BASE_URL = process.env.SETU_BASE_URL || 'https://dg-sandbox.setu.co';
const SETU_CLIENT_ID = process.env.SETU_CLIENT_ID;
const SETU_CLIENT_SECRET = process.env.SETU_CLIENT_SECRET;
const SETU_PRODUCT_INSTANCE_ID =
  process.env.SETU_EMPLOYMENT_PRODUCT_INSTANCE_ID || process.env.SETU_PRODUCT_INSTANCE_ID;

const fetchEmploymentHistoryFlow = async ({ userId, mobileNumber, candidateName = '', correlationId = 'N/A' }) => {
  const cleanMobile = String(mobileNumber).trim();
  const maskedMobile = `${cleanMobile.slice(0, 2)}******${cleanMobile.slice(-2)}`;

  // 1. Setu API Call
  const response = await axios.post(
    `${SETU_BASE_URL}/api/sync/mobile-to-employment-history`,
    { mobileNumber: cleanMobile },
    {
      headers: {
        'content-type': 'application/json',
        'x-client-id': SETU_CLIENT_ID,
        'x-client-secret': SETU_CLIENT_SECRET,
        'x-product-instance-id': SETU_PRODUCT_INSTANCE_ID,
        'x-correlation-id': correlationId,
      },
      timeout: 45000,
    }
  );

  const rawList = response.data?.data || [];
  const epfoName = (rawList[0]?.name || '').toLowerCase().trim();
  const userEnteredName = candidateName.toLowerCase().trim();
  const isNameMatched = Boolean(
    epfoName && userEnteredName && (epfoName.includes(userEnteredName) || userEnteredName.includes(epfoName))
  );

  let verificationStatus = 'VERIFIED';
  if (rawList.length === 0) {
    verificationStatus = 'NOT_FOUND';
  } else if (!isNameMatched && candidateName) {
    verificationStatus = 'FLAGGED_MISMATCH';
  }

  const taggedRecords = tagEmploymentRecordsWithCurrent(rawList);

  const savedData = await EmploymentVerification.create({
    userId,
    correlationId,
    setuRequestId: response.data?.id,
    maskedMobileNumber: maskedMobile,
    records: taggedRecords,
    totalRecordsFound: rawList.length,
    isNameMatched,
    verificationStatus,
  });

  return savedData;
};

/**
 * Fetch Employment History using UAN Number (12-digit)
 * Setu API: POST /api/sync/uan-to-employment-history
 */
const fetchEmploymentByUanFlow = async ({ userId, uan, groupId, correlationId = 'N/A' }) => {
  const cleanUan = String(uan).trim().replace(/\D/g, '');
  const maskedUan = `${cleanUan.slice(0, 4)}****${cleanUan.slice(-2)}`;

  const payload = { uan: cleanUan };
  if (groupId) payload.groupId = groupId;

  let response;
  try {
    response = await axios.post(
      `${SETU_BASE_URL}/api/sync/uan-to-employment-history`,
      payload,
      {
        headers: {
          'content-type': 'application/json',
          'x-client-id': SETU_CLIENT_ID,
          'x-client-secret': SETU_CLIENT_SECRET,
          'x-product-instance-id': SETU_PRODUCT_INSTANCE_ID,
          'x-correlation-id': correlationId,
        },
        timeout: 45000,
      }
    );
  } catch (err) {
    const rawMsg =
      err.response?.data?.message ||
      err.response?.data?.error?.message ||
      err.response?.data?.error?.detail ||
      err.response?.data?.detail ||
      err.message;

    logger.error('Setu UAN to Employment History error', {
      correlationId,
      userId,
      statusCode: err.response?.status || 500,
      error: err.response?.data || err.message,
    });

    let friendlyMsg = 'Invalid UAN number. Please enter a valid 12-digit UAN number.';
    const lower = String(rawMsg || '').toLowerCase();
    if (lower.includes('no records') || lower.includes('not found')) {
      friendlyMsg = 'No EPFO employment records found for this UAN. Please enter a valid registered UAN or add employment manually.';
    } else if (rawMsg && !lower.includes('bad request') && !lower.includes('error') && !lower.includes('failed')) {
      friendlyMsg = rawMsg;
    }

    const error = new Error(friendlyMsg);
    error.statusCode = err.response?.status && err.response.status < 500 ? err.response.status : 400;
    throw error;
  }

  const rawList = response.data?.data || [];
  let verificationStatus = rawList.length === 0 ? 'NOT_FOUND' : 'VERIFIED';

  const savedData = await EmploymentVerification.create({
    userId,
    correlationId,
    setuRequestId: response.data?.id,
    maskedMobileNumber: maskedUan, // reuse field to store masked UAN
    records: tagEmploymentRecordsWithCurrent(rawList),
    totalRecordsFound: rawList.length,
    isNameMatched: true,
    verificationStatus,
  });

  return savedData;
};

module.exports = { fetchEmploymentHistoryFlow, fetchEmploymentByUanFlow };
