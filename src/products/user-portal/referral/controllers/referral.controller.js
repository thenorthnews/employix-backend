const {
  createReferenceInvitation,
  getUserReferences,
  resendReferenceInvitation,
  getReferenceShareLink,
  validateVerificationToken,
  sendRefereeEmailOtp,
  verifyRefereeEmailOtp,
  submitRefereeFeedback,
} = require('../services/referral.service');
const { success, badRequest, serverError } = require('../../../../utils/response');
const logger = require('../../../../utils/logger');

/**
 * Add a new professional reference (Candidate authenticated)
 */
const addReference = async (req, res) => {
  try {
    const referrerId = req.user?._id || req.user?.id;
    const { refereeName, refereeEmail, refereeRole } = req.body;

    if (!refereeName || !refereeName.trim()) {
      return badRequest(res, 'Reference name is required.');
    }
    if (!refereeEmail || !refereeEmail.trim()) {
      return badRequest(res, 'Reference email address is required.');
    }
    if (!refereeRole || !refereeRole.trim()) {
      return badRequest(res, 'Reference role or designation is required.');
    }

    const result = await createReferenceInvitation({
      referrerId,
      refereeName,
      refereeEmail,
      refereeRole,
    });

    return success(res, result, 'Reference invitation created and email sent successfully.');
  } catch (err) {
    logger.error('Failed to add reference', { error: err.message });
    return badRequest(res, err.message);
  }
};

/**
 * Get references & reward points balance for candidate (Candidate authenticated)
 */
const getReferences = async (req, res) => {
  try {
    const referrerId = req.user?._id || req.user?.id;
    const data = await getUserReferences(referrerId);
    return success(res, data, 'References retrieved successfully.');
  } catch (err) {
    logger.error('Failed to get references', { error: err.message });
    return serverError(res, err.message);
  }
};

/**
 * Resend invitation email (Candidate authenticated)
 */
const resendInvitation = async (req, res) => {
  try {
    const referrerId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const result = await resendReferenceInvitation(referrerId, id);
    return success(res, result, result.message);
  } catch (err) {
    logger.error('Failed to resend reference invitation', { error: err.message });
    return badRequest(res, err.message);
  }
};

/**
 * Validate token on public referee verification landing page (Public)
 */
const validateToken = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) {
      return badRequest(res, 'Token query parameter is required.');
    }
    const result = await validateVerificationToken(token);
    return success(res, result, 'Verification session is valid.');
  } catch (err) {
    return badRequest(res, err.message);
  }
};

/**
 * Send email OTP to referee (Public)
 */
const sendOtp = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return badRequest(res, 'Verification token is required.');
    }
    const result = await sendRefereeEmailOtp(token);
    return success(res, result, result.message);
  } catch (err) {
    return badRequest(res, err.message);
  }
};

/**
 * Verify referee's 6-digit email OTP (Public)
 */
const verifyOtp = async (req, res) => {
  try {
    const { token, otp } = req.body;
    if (!token || !otp) {
      return badRequest(res, 'Verification token and OTP are required.');
    }
    const result = await verifyRefereeEmailOtp(token, otp);
    return success(res, result, result.message);
  } catch (err) {
    return badRequest(res, err.message);
  }
};

/**
 * Submit feedback & grant candidate +5 points (Public)
 */
const submitFeedback = async (req, res) => {
  try {
    const {
      token,
      workedTogether,
      companyName,
      startDate,
      endDate,
      isCurrentlyWorking,
      diligence,
      enthusiasm,
      respectfulness,
      relationship,
      rating,
      feedback,
      recommendation,
    } = req.body;

    if (!token) {
      return badRequest(res, 'Verification token is required.');
    }

    const result = await submitRefereeFeedback(token, {
      workedTogether,
      companyName,
      startDate,
      endDate,
      isCurrentlyWorking,
      diligence,
      enthusiasm,
      respectfulness,
      relationship,
      rating,
      feedback,
      recommendation,
    });
    return success(res, result, result.message);
  } catch (err) {
    return badRequest(res, err.message);
  }
};

/**
 * Get shareable link for reference (Candidate authenticated)
 */
const getShareLink = async (req, res) => {
  try {
    const referrerId = req.user?._id || req.user?.id;
    const { id } = req.params;
    const data = await getReferenceShareLink(referrerId, id);
    return success(res, data, 'Share link generated successfully.');
  } catch (err) {
    logger.error('Failed to get share link', { error: err.message });
    return badRequest(res, err.message);
  }
};

module.exports = {
  addReference,
  getReferences,
  resendInvitation,
  getShareLink,
  validateToken,
  sendOtp,
  verifyOtp,
  submitFeedback,
};
