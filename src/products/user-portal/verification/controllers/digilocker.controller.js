const {
  initializeDigilockerSession,
  fetchAndProcessDigilockerDocuments,
} = require('../services/surepassDigilocker.service');
const DigilockerSession = require('../../models/digilockerSession.model');
const {
  digilockerInitializeSchema,
  digilockerGetDocsSchema,
} = require('../../../../validation/userPortal.validation');
const { success, badRequest, serverError } = require('../../../../utils/response');
const logger = require('../../../../utils/logger');
const { recordAuditEvent } = require('../../../../common/audit/audit.service');

/**
 * Step 1: Initialize DigiLocker Session
 * POST /api/v1/user-portal/kyc/digilocker/initialize
 */
const initializeDigilocker = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('DigiLocker initialize rejected: Missing authenticated user context', {
        correlationId,
        ip: req.ip,
      });
      return badRequest(res, 'User authentication context is required');
    }

    const { error, value } = digilockerInitializeSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      return badRequest(res, validationErrors);
    }

    const redirectUrl = value.redirect_url || value.redirectUrl;
    const config = value.config || {};

    // Forward any extra body parameters into config
    const { redirect_url, redirectUrl: _r, config: _c, ...extraParams } = req.body;
    const mergedConfig = { ...extraParams, ...config };

    const result = await initializeDigilockerSession({
      userId,
      redirectUrl,
      config: mergedConfig,
      correlationId,
    });

    // Record audit event
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_DIGILOCKER_INITIATE',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        clientId: result.clientId,
        redirectUrl: result.redirectUrl,
      },
    });

    return success(
      res,
      {
        url: result.url,
        client_id: result.clientId,
        clientId: result.clientId,
        redirect_url: result.redirectUrl,
        sessionId: result.sessionId,
      },
      'DigiLocker session initialized successfully. Redirect user to url.'
    );
  } catch (err) {
    const statusCode = err.statusCode || 500;
    logger.error('Failed to initialize DigiLocker session', {
      correlationId,
      userId,
      error: err.message,
      statusCode,
      details: err.details,
    });

    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_DIGILOCKER_INITIATE',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { error: err.message },
    });

    return res.status(statusCode).json({
      success: false,
      statusCode,
      message: err.message || 'Failed to initialize DigiLocker session',
      details: err.details || null,
    });
  }
};

/**
 * Step 2: Fetch Verified Documents & Parse Data
 * GET /api/v1/user-portal/kyc/digilocker/get-documents/:clientId
 * (Also supports clientId in query / body / params)
 */
const getDigilockerDocuments = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id || null;
  const clientId =
    req.params.clientId ||
    req.params.client_id ||
    req.query.clientId ||
    req.query.client_id ||
    req.body.clientId ||
    req.body.client_id;

  try {
    const { error } = digilockerGetDocsSchema.validate({ clientId });
    if (error) {
      return badRequest(res, error.details[0].message);
    }

    const result = await fetchAndProcessDigilockerDocuments({
      clientId,
      userId,
      correlationId,
      reqIp: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Record audit event
    recordAuditEvent({
      correlationId,
      userId: userId || 'SESSION_USER',
      action: 'KYC_DIGILOCKER_FETCH_DOCS',
      status: result.success ? 'SUCCESS' : 'PENDING',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        clientId,
        verificationSummary: result.verificationSummary,
      },
    });

    // If request comes directly from browser redirect navigation, redirect to KYC verification screen
    const isBrowserHtmlRequest = req.method === 'GET' && req.headers?.accept?.includes('text/html');
    if (isBrowserHtmlRequest) {
      const frontendBase = process.env.CLIENT_APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(302, `${frontendBase}/kyc-verification?step=education&client_id=${encodeURIComponent(clientId)}`);
    }

    return success(res, result, result.message || 'DigiLocker documents processed successfully');
  } catch (err) {
    const statusCode = err.statusCode || 500;
    logger.error('Error fetching DigiLocker verified documents', {
      correlationId,
      clientId,
      userId,
      error: err.message,
      statusCode,
      details: err.details,
    });

    recordAuditEvent({
      correlationId,
      userId: userId || 'UNKNOWN',
      action: 'KYC_DIGILOCKER_FETCH_DOCS',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        clientId,
        error: err.message,
      },
    });

    return res.status(statusCode).json({
      success: false,
      statusCode,
      message: err.message || 'Failed to fetch DigiLocker verified documents',
      details: err.details || null,
    });
  }
};

/**
 * Helper: Check status of DigiLocker session stored locally
 * GET /api/v1/user-portal/kyc/digilocker/session/:clientId
 */
const getDigilockerSessionStatus = async (req, res) => {
  const clientId = req.params.clientId || req.params.client_id;
  try {
    if (!clientId) {
      return badRequest(res, 'Client ID is required');
    }

    const session = await DigilockerSession.findOne({ clientId }).select('-rawDocumentsResponse -rawInitializeResponse');
    if (!session) {
      return res.status(404).json({
        success: false,
        statusCode: 404,
        message: 'DigiLocker session not found',
      });
    }

    return success(res, session, 'DigiLocker session status fetched');
  } catch (err) {
    return serverError(res, err.message);
  }
};

module.exports = {
  initializeDigilocker,
  getDigilockerDocuments,
  getDigilockerSessionStatus,
};
