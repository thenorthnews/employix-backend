const {
  processAadhaarVerificationFlow,
} = require('../services/aadhaar.service');
const {
  processPanVerificationFlow,
  processPanOcrFlow,
} = require('../services/pan.service');
const {
  verifyVoterIdRecord,
  extractVoterOcrData,
} = require('../services/voterId.service');

const {
  aadhaarVerificationSchema,
  panVerificationSchema,
  panVerificationOcrSchema,
  voterIdVerificationSchema,
  employmentHistorySchema,
} = require('../../../../validation/userPortal.validation');
const { success, badRequest, serverError, badRequestEmploymentHistory } = require('../../../../utils/response');
const logger = require('../../../../utils/logger');
const { recordAuditEvent } = require('../../../../common/audit/audit.service');
const { fetchEmploymentHistoryFlow, fetchEmploymentByUanFlow } = require('../services/employment.service');
const { extractDlOcrData } = require('../services/dlVerification.service');
const User = require('../../../../common/users/user.model');
const Identification = require('../../models/identification.model');
const ManualEmployment = require('../../models/manualEmployment.model');
const EmploymentVerification = require('../../models/employmentVerification.model');
const Qualification = require('../../models/qualification.model');
const Certification = require('../../models/certification.model');
const {
  addQualificationService,
  getQualificationsService,
  deleteQualificationService,
  addCertificationService,
  getCertificationsService,
  deleteCertificationService,
} = require('../services/education.service');

const { resolveErrorInfo, calculateEmployixScore, calculateKycStatus } = require('../../../../helpers/documentHelper');

const getEducationState = async (userId) => {
  const qualCount = await Qualification.countDocuments({ userId });
  const certCount = await Certification.countDocuments({ userId });
  const hasEdu = qualCount > 0 || certCount > 0;

  const verifiedQualCount = await Qualification.countDocuments({
    userId,
    isVerified: true,
    verificationStatus: 'verified',
  });
  const verifiedCertCount = await Certification.countDocuments({
    userId,
    isVerified: true,
    verificationStatus: 'verified',
  });
  const eduVerified = verifiedQualCount > 0 || verifiedCertCount > 0;

  return { hasEdu, eduVerified, qualCount, certCount, verifiedQualCount, verifiedCertCount };
};

const getFullUserKycState = async (userId) => {
  const [currentUser, records, empRecord, manualEmpRecord, eduState] = await Promise.all([
    User.findById(userId),
    Identification.find({
      userId,
      documentType: { $in: ['aadhaar', 'pan', 'voter_id', 'driving_license'] },
    }).lean(),
    EmploymentVerification.findOne({
      userId,
      verificationStatus: { $in: ['VERIFIED', 'verified'] },
    }),
    ManualEmployment.findOne({ userId }),
    getEducationState(userId),
  ]);

  const aadhaarDone = currentUser?.aadhaarStatus === 1 || records.some((r) => r.documentType === 'aadhaar' && r.verificationStatus === 'verified');
  const voterDone = currentUser?.voterStatus === 1 || records.some((r) => r.documentType === 'voter_id' && r.verificationStatus === 'verified');
  const dlDone = currentUser?.dlStatus === 1 || records.some((r) => r.documentType === 'driving_license' && r.verificationStatus === 'verified');
  const employmentDone = currentUser?.employmentStatus === 1 || Boolean(empRecord) || Boolean(manualEmpRecord);
  const educationDone = eduState.hasEdu;

  const kycState = currentUser?.kycStatus === 8 ? 8 : calculateKycStatus({
    aadhaarDone,
    voterDone,
    dlDone,
    empDone: employmentDone,
    eduDone: educationDone,
  });

  const newScore = calculateEmployixScore({
    aadhaarDone,
    voterDone,
    dlDone,
    empDone: employmentDone,
    eduDone: eduState.eduVerified,
  });

  return {
    currentUser,
    kycState,
    newScore,
    aadhaarDone,
    voterDone,
    dlDone,
    employmentDone,
    educationDone,
    eduState,
  };
};

const buildAadhaarPayload = (req) => ({
  consent: req.body.consent,
  consentPurpose: req.body.consentPurpose,
  groupId: req.body.groupId,
  documentFront: req.files?.documentFront,
  documentBack: req.files?.documentBack,
});


const verifyAadhaarDocument = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('Aadhaar verification rejected: Missing authenticated user context', {
        correlationId,
        ip: req.ip,
      });
      return badRequest(res, 'User authentication context is required');
    }

    logger.info('Aadhaar verification request initiated', {
      correlationId,
      userId,
      hasFrontFile: Boolean(req.files?.documentFront?.length),
      hasBackFile: Boolean(req.files?.documentBack?.length),
    });

    const payload = buildAadhaarPayload(req);
    const { error, value } = aadhaarVerificationSchema.validate(payload, {
      abortEarly: false,
    });

    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      logger.warn('Aadhaar verification schema validation failed', {
        correlationId,
        userId,
        errors: validationErrors,
      });
      return badRequest(res, validationErrors);
    }

  

    const frontFile = (value.documentFront && value.documentFront[0]) || req.files?.documentFront?.[0] || req.file;
    const backFile = (value.documentBack && value.documentBack[0]) || req.files?.documentBack?.[0] || null;

    if (!frontFile || !frontFile.buffer) {
      return badRequest(res, 'Please upload a valid front image of your Aadhaar card');
    }

    const result = await processAadhaarVerificationFlow({
      userId,
      correlationId,
      frontFile,
      backFile,
      groupId: value.groupId,
      consentPurpose: value.consentPurpose,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_AADHAAR_VERIFY',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'aadhaar',
        verificationStatus: result.verificationStatus,
      },
    });

    // Update User Document Status & Score (+20 Points) in DB
    const currentUser = await User.findById(userId);
    const newAadhaarStatus = 1;
    const currentVoterStatus = currentUser?.voterStatus || 0;
    const currentEmpStatus = currentUser?.employmentStatus || 0;
    const currentDlStatus = currentUser?.dlStatus || 0;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const newKycState = calculateKycStatus({
      aadhaarDone: true,
      voterDone: currentVoterStatus === 1,
      dlDone: currentDlStatus === 1,
      empDone: currentEmpStatus === 1,
      eduDone: hasEdu,
    });
    const newScore = calculateEmployixScore({
      aadhaarDone: true,
      voterDone: currentVoterStatus === 1,
      dlDone: currentDlStatus === 1,
      empDone: currentEmpStatus === 1,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        aadhaarStatus: newAadhaarStatus,
        kycStatus: newKycState,
        employixScore: newScore,
        isVerified: true,
      },
    });

    await Identification.findOneAndUpdate(
      { userId, documentType: 'aadhaar' },
      {
        $set: {
          verificationMethod: value.documentFront ? 'ocr_scan' : 'manual_number',
          verificationStatus: 'verified',
          scoreEarned: 20,
          consentGiven: true,
          consentTimestamp: new Date(),
          consentPurpose: value.consentPurpose || 'Aadhaar identity verification for Employix Trust Score',
          consentIp: req.ip,
          verifiedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return success(
      res,
      {
        ...result,
        aadhaarStatus: 1,
        scoreBoost: 20,
        newScore,
        kycStatus: newKycState,
      },
      'Aadhaar document verified successfully'
    );
  } catch (err) {
    console.log("🚀 ~ verifyAadhaarDocument ~ err:", err)
    const { statusCode, message } = resolveErrorInfo(err, 'Aadhaar verification failed');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_AADHAAR_OCR',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'aadhaar',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('Aadhaar verification execution failed', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};


/**
 * PAN Verification Handler (Database & ITD Verification)
 */
const verifyPanDocument = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('PAN verification rejected: Missing authenticated user context', {
        correlationId,
        ip: req.ip,
      });
      return badRequest(res, 'User authentication context is required');
    }

    logger.info('PAN verification request initiated', {
      correlationId,
      userId,
      panProvided: Boolean(req.body.pan),
    });

    const { error, value } = panVerificationSchema.validate(req.body, { abortEarly: false });
    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      logger.warn('PAN verification schema validation failed', {
        correlationId,
        userId,
        errors: validationErrors,
      });
      return badRequest(res, validationErrors);
    }

    const result = await processPanVerificationFlow({
      userId,
      pan: value.pan,
      name: value.name,
      dob: value.dob,
      correlationId,
      consent: value.consent,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_PAN_VERIFY',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'pan',
        verificationStatus: result.verificationStatus,
        panStatus: result.panStatus,
      },
    });

    logger.info('PAN verification completed successfully', {
      correlationId,
      userId,
      verificationStatus: result.verificationStatus,
      panStatus: result.panStatus,
    });

    // Update User Document Status & Score (+20 Points) in DB: Status 1 (Complete)
    const currentUser = await User.findById(userId);
    const currentAadhaarStatus = currentUser?.aadhaarStatus || 0;
    const newPanStatus = 1;
    const newKycState = currentAadhaarStatus === 1 ? 2 : 1;
    const newScore = parseFloat((58.4 + (currentAadhaarStatus === 1 ? 20 : 0) + 20).toFixed(1));

    await User.findByIdAndUpdate(userId, {
      $set: {
        panStatus: newPanStatus,
        kycStatus: newKycState,
        employixScore: newScore,
        isVerified: true,
      },
    });

    const maskedPan = `${value.pan.slice(0, 5)}****${value.pan.slice(-1)}`;
    await Identification.findOneAndUpdate(
      { userId, documentType: 'pan' },
      {
        $set: {
          verificationMethod: 'manual_number',
          maskedDocumentNumber: maskedPan,
          verificationStatus: 'verified',
          scoreEarned: 20,
          consentGiven: true,
          consentTimestamp: new Date(),
          consentPurpose: value.consentPurpose || 'PAN identity verification for Employix Trust Score',
          consentIp: req.ip,
          verifiedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return success(res, { ...result, scoreBoost: 20, newScore, maskedPan }, 'PAN verified successfully');
  } catch (err) {
    const { statusCode, message } = resolveErrorInfo(err, 'PAN verification failed');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_PAN_VERIFY',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'pan',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('PAN verification execution failed', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};

/**
 * PAN OCR Extraction Handler (Image to Text Auto-fill)
 */
const extractPanOcrDocument = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('PAN OCR rejected: Missing authenticated user context', {
        correlationId,
        ip: req.ip,
      });
      return badRequest(res, 'User authentication context is required');
    }

    const payload = {
      panImage: req.files?.panImage,
      consent: req.body.consent,
    };

    const { error, value } = panVerificationOcrSchema.validate(payload, { abortEarly: false });
    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      logger.warn('PAN OCR schema validation failed', {
        correlationId,
        userId,
        errors: validationErrors,
      });
      return badRequest(res, validationErrors);
    }

    const panFile = value.panImage[0];

    logger.info('PAN OCR extraction initiated', {
      correlationId,
      userId,
      fileSize: panFile.size,
      mimeType: panFile.mimetype,
    });

    const extractedData = await processPanOcrFlow({
      userId,
      file: panFile,
      correlationId,
      consent: value.consent,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_PAN_OCR',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'pan',
        verificationStatus: extractedData.verificationStatus,
        confidenceScore: extractedData.score || 'N/A',
      },
    });

    logger.info('PAN OCR extraction completed successfully', {
      correlationId,
      userId,
      confidenceScore: extractedData.score || 'N/A',
    });

    // Update User Document Status & Score (+20 Points) in DB: Status 1 (Complete)
    const currentUser = await User.findById(userId);
    const currentAadhaarStatus = currentUser?.aadhaarStatus || 0;
    const newPanStatus = 1;
    const newKycState = currentAadhaarStatus === 1 ? 2 : 1;
    const newScore = parseFloat((58.4 + (currentAadhaarStatus === 1 ? 20 : 0) + 20).toFixed(1));

    await User.findByIdAndUpdate(userId, {
      $set: {
        panStatus: newPanStatus,
        kycStatus: newKycState,
        employixScore: newScore,
        isVerified: true,
      },
    });

    const maskedPan = extractedData?.pan
      ? `${extractedData.pan.slice(0, 5)}****${extractedData.pan.slice(-1)}`
      : 'ABCDE****F';

    await Identification.findOneAndUpdate(
      { userId, documentType: 'pan' },
      {
        $set: {
          verificationMethod: 'ocr_scan',
          maskedDocumentNumber: maskedPan,
          verificationStatus: 'verified',
          scoreEarned: 20,
          consentGiven: true,
          consentTimestamp: new Date(),
          consentPurpose: value.consentPurpose || 'PAN OCR document verification for Employix Trust Score',
          consentIp: req.ip,
          verifiedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    return success(res, { ...extractedData, scoreBoost: 20, newScore, maskedPan }, 'PAN details extracted successfully');
  } catch (err) {
    console.log("🚀 ~ extractPanOcrDocument ~ err:", err)
    
    const { statusCode, message } = resolveErrorInfo(err, 'Failed to extract PAN details');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_PAN_OCR',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'pan',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('PAN OCR extraction failed', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};

/**
 * Voter ID Verification Handler
 */
const verifyVoterId = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('Unauthorized request in verifyVoterId controller', { correlationId });
      return badRequest(res, 'User authentication required');
    }

    const { error, value } = voterIdVerificationSchema.validate(req.body, { abortEarly: false });
    console.log("🚀 ~ verifyVoterId ~ value:", value)
    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      console.log("🚀 ~ verifyVoterId ~ validationErrors:", validationErrors)
      logger.warn('Validation error in verifyVoterId', {
        correlationId,
        userId,
        errors: validationErrors,
      });
      return badRequest(res, validationErrors);
    }

    const result = await verifyVoterIdRecord({
      userId,
      number: value.number,
      consentPurpose: value.consentPurpose,
      correlationId,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_VOTER_VERIFY',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'voter_id',
        verificationStatus: result.verificationStatus,
      },
    });

    const currentUser = await User.findById(userId);
    const currentAadhaarStatus = currentUser?.aadhaarStatus || 0;
    const currentEmpStatus = currentUser?.employmentStatus || 0;
    const currentDlStatus = currentUser?.dlStatus || 0;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const newKycStatus = calculateKycStatus({
      aadhaarDone: currentAadhaarStatus === 1,
      voterDone: true,
      dlDone: currentDlStatus === 1,
      empDone: currentEmpStatus === 1,
      eduDone: hasEdu,
    });
    const newScore = calculateEmployixScore({
      aadhaarDone: currentAadhaarStatus === 1,
      voterDone: true,
      dlDone: currentDlStatus === 1,
      empDone: currentEmpStatus === 1,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        voterStatus: 1,
        kycStatus: newKycStatus,
        employixScore: newScore,
        address: result.address?.fullAddress || null,
      },
    });

    return success(res, { ...result, voterStatus: 1, scoreBoost: 20, newScore, kycStatus: newKycStatus }, 'Voter ID and address verified successfully');
  } catch (err) {
    console.log("🚀 ~ verifyVoterId ~ err:", err)
    const { statusCode, message } = resolveErrorInfo(err, 'Invalid voter id number');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_VOTER_VERIFY',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'voter_id',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('Error occurred in verifyVoterId controller', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};

/**
 * Voter ID OCR Extraction Handler
 */
const processVoterOcr = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('Unauthorized request in processVoterOcr controller', { correlationId });
      return badRequest(res, 'User authentication required');
    }

    const frontFile = (req.files?.documentFront && req.files.documentFront[0]) || req.file;
    const backFile = (req.files?.documentBack && req.files.documentBack[0]) || null;

    if (!frontFile || !frontFile.buffer) {
      return badRequest(res, 'Front side image of Voter ID (documentFront) is mandatory');
    }

    const result = await extractVoterOcrData({
      userId,
      frontFile,
      backFile,
      consentPurpose: req.body?.consentPurpose,
      correlationId,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_VOTER_OCR',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'voter_id',
        verificationStatus: result.verificationStatus,
      },
    });

    const currentVoterUser = await User.findById(userId);
    const aadhaarState = currentVoterUser?.aadhaarStatus || 0;
    const empState = currentVoterUser?.employmentStatus || 0;
    const dlState = currentVoterUser?.dlStatus || 0;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const voterKycStatus = calculateKycStatus({
      aadhaarDone: aadhaarState === 1,
      voterDone: true,
      dlDone: dlState === 1,
      empDone: empState === 1,
      eduDone: hasEdu,
    });
    const voterNewScore = calculateEmployixScore({
      aadhaarDone: aadhaarState === 1,
      voterDone: true,
      dlDone: dlState === 1,
      empDone: empState === 1,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        voterStatus: 1,
        kycStatus: voterKycStatus,
        employixScore: voterNewScore,
        address: result.address?.fullAddress || null,
      },
    });

    return success(res, { ...result, voterStatus: 1, scoreBoost: 20, newScore: voterNewScore, kycStatus: voterKycStatus }, 'Voter ID OCR extracted and verified successfully');
  } catch (err) {
    const { statusCode, message } = resolveErrorInfo(err, 'Failed to process Voter ID OCR');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_VOTER_OCR',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'voter_id',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('Error in processVoterOcr controller', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};


const getEmploymentHistory = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('Employment history check rejected: Unauthorized', { correlationId, ip: req.ip });
      return badRequest(res, 'User authentication required');
    }

    const { error, value } = employmentHistorySchema.validate(req.body, { abortEarly: false });
    if (error) {
      const validationErrors = error.details.map((item) => item.message).join(', ');
      logger.warn('Validation error in employment history check', {
        correlationId,
        userId,
        errors: validationErrors,
      });
      return badRequest(res, validationErrors);
    }

    const maskedMobile = `${value.mobileNumber.slice(0, 2)}******${value.mobileNumber.slice(-2)}`;

    const result = await fetchEmploymentHistoryFlow({
      userId,
      mobileNumber: value.mobileNumber,
      groupId: value.groupId,
      correlationId,
    });

    // Audit Log on Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'VERIFY_EMPLOYMENT_HISTORY',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        maskedMobile,
        recordsFound: Array.isArray(result?.data) ? result.data.length : 0,
      },
    });

    logger.info('Employment history fetched successfully', {
      correlationId,
      userId,
      maskedMobile,
    });

    // Mark employment verified in user record & recalculate 7-step score (Employment = 35 pts)
    const currentUser = await User.findById(userId);
    const aadhaarDone = currentUser?.aadhaarStatus === 1;
    const voterDone = currentUser?.voterStatus === 1;
    const dlDone = currentUser?.dlStatus === 1;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const newKycState = calculateKycStatus({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: hasEdu,
    });
    const newScore = calculateEmployixScore({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        employmentStatus: 1,
        kycStatus: newKycState,
        employixScore: newScore,
      },
    });

    return success(
      res,
      { ...result.toObject(), employmentStatus: 1, kycStatus: newKycState, employixScore: newScore },
      'Employment history fetched successfully'
    );
  } catch (err) {
    const { statusCode, message } = resolveErrorInfo(err, 'Failed to fetch employment history');

    // Audit Log on Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'VERIFY_EMPLOYMENT_HISTORY',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('Employment history fetch failed', {
      correlationId,
      userId,
      statusCode,
      error: message,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};

/**
 * Get Employment History using UAN Number (12-digit)
 * POST /user-portal/kyc/employment-history/uan
 */
const getEmploymentByUan = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) return badRequest(res, 'User authentication required');

    const { uan, groupId } = req.body;
    const cleanUan = String(uan || '').trim().replace(/\D/g, '');

    if (!cleanUan) {
      return badRequest(res, 'Please provide your 12-digit UAN number.');
    }
    if (cleanUan.length !== 12) {
      return badRequest(res, 'Invalid UAN number. UAN must be exactly 12 digits.');
    }
    if (cleanUan.startsWith('0')) {
      return badRequest(res, 'Invalid UAN number. UAN cannot start with 0.');
    }
    if (/^(\d)\1{11}$/.test(cleanUan)) {
      return badRequest(res, 'Invalid UAN number. Repeating digits sequence is not allowed.');
    }
    if (cleanUan === '123456789012' || cleanUan === '234567890123') {
      return badRequest(res, 'Invalid UAN number. Sequential dummy numbers are not allowed.');
    }

    const result = await fetchEmploymentByUanFlow({ userId, uan: cleanUan, groupId, correlationId });

    if (!result || result.totalRecordsFound === 0 || !result.records || result.records.length === 0) {
      return badRequest(
        res,
        'No EPFO employment records found for this UAN. Please enter a valid registered UAN or add employment manually.'
      );
    }

    // Mark employment verified & update 7-step score (Employment = 35 pts)
    const currentUser = await User.findById(userId);
    const aadhaarDone = currentUser?.aadhaarStatus === 1;
    const voterDone = currentUser?.voterStatus === 1;
    const dlDone = currentUser?.dlStatus === 1;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const newKycState = calculateKycStatus({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: hasEdu,
    });
    const newScore = calculateEmployixScore({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        employmentStatus: 1,
        kycStatus: newKycState,
        employixScore: newScore,
      },
    });

    recordAuditEvent({
      correlationId, userId,
      action: 'VERIFY_EMPLOYMENT_UAN',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { maskedUan: `${cleanUan.slice(0, 4)}****${cleanUan.slice(-2)}`, recordsFound: result.totalRecordsFound },
    });

    logger.info('Employment history via UAN fetched', { correlationId, userId, totalRecords: result.totalRecordsFound });

    return success(
      res,
      { ...result.toObject(), employmentStatus: 1, kycStatus: newKycState, employixScore: newScore },
      'Employment history fetched via UAN successfully'
    );
  } catch (err) {    
    const { statusCode, message } = resolveErrorInfo(err, 'Failed to fetch employment history via UAN');
    logger.error('UAN employment fetch failed', { correlationId, userId, statusCode, error: message, gateway: err.response?.data || null });

    let friendlyMessage = message;
    const lower = String(message || '').toLowerCase();
    if (
      lower.includes('bad request') ||
      lower.includes('not found') ||
      lower.includes('invalid') ||
      lower.includes('failed to fetch') ||
      lower.includes('no records') ||
      lower.includes('resource_not_found') ||
      lower.includes('uan')
    ) {
      if (lower.includes('no records')) {
        friendlyMessage = 'No EPFO employment records found for this UAN. Please enter a valid registered UAN or add employment manually.';
      } else {
        friendlyMessage = 'Invalid UAN number. Please enter a valid 12-digit UAN number.';
      }
    }

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, friendlyMessage);
    }
    return serverError(res, friendlyMessage);
  }
};

/**
 * Add Manual Employment Record
 */
const addManualEmployment = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;
  try {
    if (!userId) return badRequest(res, 'User authentication required');
    const { companyName, designation, startDate, endDate, isCurrent, description } = req.body;
    if (!companyName || !designation || !startDate) {
      return badRequest(res, 'Company name, designation, and start date are required');
    }
    const newRecord = await ManualEmployment.create({
      userId,
      companyName: companyName.trim(),
      designation: designation.trim(),
      startDate: startDate.trim(),
      endDate: isCurrent ? null : (endDate?.trim() || null),
      isCurrent: Boolean(isCurrent),
      description: description?.trim() || '',
    });
    const currentUser = await User.findById(userId);
    const aadhaarDone = currentUser?.aadhaarStatus === 1;
    const voterDone = currentUser?.voterStatus === 1;
    const dlDone = currentUser?.dlStatus === 1;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const newKycState = calculateKycStatus({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: hasEdu,
    });
    const newScore = calculateEmployixScore({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: true,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        employmentStatus: 1,
        kycStatus: newKycState,
        employixScore: newScore,
      },
    });
    logger.info('Manual employment record added', { correlationId, userId, companyName });
    return success(
      res,
      { record: newRecord, employmentStatus: 1, kycStatus: newKycState, employixScore: newScore },
      'Employment record added successfully'
    );
  } catch (err) {
    logger.error('Failed to add manual employment', { correlationId, userId, error: err.message });
    return serverError(res, err.message);
  }
};

/**
 * Get all employment records for user (manual + EPFO)
 */
const getManualEmployments = async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  try {
    if (!userId) return badRequest(res, 'User authentication required');
    const manualRecords = await ManualEmployment.find({ userId }).sort({ createdAt: -1 });
    const epfoRecords = await EmploymentVerification.find({ userId }).sort({ createdAt: -1 }).limit(1);
    return success(res, { manualRecords, epfoRecords }, 'Employment records fetched');
  } catch (err) {
    return serverError(res, err.message);
  }
};

/**
 * Delete a manual employment record
 */
const deleteManualEmployment = async (req, res) => {
  const userId = req.user?._id || req.user?.id;
  const { id } = req.params;
  try {
    if (!userId) return badRequest(res, 'User authentication required');
    const record = await ManualEmployment.findOneAndDelete({ _id: id, userId });
    if (!record) return badRequest(res, 'Record not found');
    const remaining = await ManualEmployment.countDocuments({ userId });
    const epfoRemaining = await EmploymentVerification.countDocuments({ userId });
    const newStatus = remaining > 0 || epfoRemaining > 0 ? 1 : 0;
    await User.findByIdAndUpdate(userId, { $set: { employmentStatus: newStatus } });
    return success(res, { employmentStatus: newStatus }, 'Record deleted successfully');
  } catch (err) {
    return serverError(res, err.message);
  }
};

const processDlOcr = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      logger.warn('Unauthorized request in processDlOcr controller', { correlationId });
      return badRequest(res, 'User authentication required');
    }

    if (req.body?.consent !== 'true' && req.body?.consent !== true) {
      return badRequest(res, 'Explicit consent is mandatory for Driving License OCR verification');
    }

    const frontFile = req.files?.documentFront?.[0];
    const backFile = req.files?.documentBack?.[0];

    if (!frontFile) {
      return badRequest(res, 'Front side image of Driving License (documentFront) is mandatory');
    }

    if (!backFile) {
      return badRequest(res, 'Back side image of Driving License (documentBack) is mandatory');
    }

    const result = await extractDlOcrData({
      userId,
      frontFile,
      backFile,
      candidateName: req.user?.name || req.body?.name || '',
      consentPurpose: req.body?.consentPurpose,
      groupId: req.body?.groupId,
      correlationId,
    });

    // Audit Log: Success
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_DL_OCR',
      status: 'SUCCESS',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'driving_license',
        verificationStatus: result.verificationStatus,
      },
    });

    const currentUser = await User.findById(userId);
    const aadhaarDone = currentUser?.aadhaarStatus === 1;
    const empDone = currentUser?.employmentStatus === 1;
    const voterDone = currentUser?.voterStatus === 1;
    const dlDone = true;
    const { hasEdu, eduVerified } = await getEducationState(userId);

    const dlKycStatus = calculateKycStatus({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone,
      eduDone: hasEdu,
    });

    const newScore = calculateEmployixScore({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone,
      eduDone: eduVerified,
    });

    await User.findByIdAndUpdate(userId, {
      $set: {
        dlStatus: 1,
        kycStatus: dlKycStatus,
        employixScore: newScore,
        isVerified: true,
      },
    });

    const resObj = result?.toObject ? result.toObject() : result;
    return success(
      res,
      {
        ...resObj,
        dlStatus: 1,
        scoreBoost: 5,
        newScore,
        kycStatus: dlKycStatus,
      },
      'Driving License OCR extracted and verified successfully'
    );
  } catch (err) {
    console.log("🚀 ~ processDlOcr ~ err:", err)
    const { statusCode, message } = resolveErrorInfo(err, 'Please upload a clear and valid Driving License image');

    // Audit Log: Failure
    recordAuditEvent({
      correlationId,
      userId,
      action: 'KYC_DL_OCR',
      status: 'FAILURE',
      endpoint: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: {
        documentType: 'driving_license',
        statusCode,
        errorMessage: message,
      },
    });

    logger.error('Error in processDlOcr controller', {
      correlationId,
      userId,
      statusCode,
      errorMessage: message,
      gatewayResponse: err.response?.data || null,
    });

    if (statusCode >= 400 && statusCode < 500) {
      return badRequest(res, message);
    }

    return serverError(res, message);
  }
};

/**
 * Get Overall KYC Status for Logged-In User
 */
const getKycStatus = async (req, res) => {
  const correlationId = req.correlationId || req.headers['x-correlation-id'] || 'N/A';
  const userId = req.user?._id || req.user?.id;

  try {
    if (!userId) {
      return badRequest(res, 'User authentication context is required');
    }

    const user = await User.findById(userId).select(
      'name email aadhaarStatus panStatus voterStatus dlStatus employmentStatus kycStatus isVerified employixScore employixId'
    );
    let userEmployixId = user?.employixId;
    if (!userEmployixId && user) {
      const code = user._id ? user._id.toString().slice(-4).toUpperCase() : Math.floor(1000 + Math.random() * 9000);
      userEmployixId = `#EMP-${code}-IN`;
      await User.findByIdAndUpdate(userId, { $set: { employixId: userEmployixId } });
    }
    const records = await Identification.find({
      userId,
      documentType: { $in: ['aadhaar', 'pan', 'voter_id', 'driving_license'] },
    }).lean();

    const aadhaarRecord = records.find(
      (r) => r.documentType === 'aadhaar' && r.verificationStatus === 'verified'
    );
    const panRecord = records.find(
      (r) => r.documentType === 'pan' && r.verificationStatus === 'verified'
    );
    const voterRecord = records.find(
      (r) => r.documentType === 'voter_id' && r.verificationStatus === 'verified'
    );
    const dlRecord = records.find(
      (r) => r.documentType === 'driving_license' && r.verificationStatus === 'verified'
    );

    const empRecord = await EmploymentVerification.findOne({
      userId,
      verificationStatus: { $in: ['VERIFIED', 'verified'] },
    });
    const manualEmpRecord = await ManualEmployment.findOne({ userId });
    const employmentDone = user?.employmentStatus === 1 || Boolean(empRecord) || Boolean(manualEmpRecord);

    const { hasEdu, eduVerified, qualCount, certCount } = await getEducationState(userId);
    const educationDone = hasEdu;

    const aadhaarDone = user?.aadhaarStatus === 1 || Boolean(aadhaarRecord);
    const voterDone = user?.voterStatus === 1 || Boolean(voterRecord);
    const panDone = user?.panStatus === 1 || Boolean(panRecord);
    const dlDone = user?.dlStatus === 1 || Boolean(dlRecord);

    const allStepsDone = aadhaarDone && employmentDone && voterDone && dlDone && educationDone;
    const computedKyc = calculateKycStatus({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: employmentDone,
      eduDone: educationDone,
    });
    const kycState = user?.kycStatus === 8 ? 8 : computedKyc;

    const currentScore = calculateEmployixScore({
      aadhaarDone,
      voterDone,
      dlDone,
      empDone: employmentDone,
      eduDone: eduVerified,
    });

    // Sync DB User record
    if (
      user &&
      (user.aadhaarStatus !== (aadhaarDone ? 1 : 0) ||
        user.employmentStatus !== (employmentDone ? 1 : 0) ||
        user.voterStatus !== (voterDone ? 1 : 0) ||
        user.dlStatus !== (dlDone ? 1 : 0) ||
        (user.kycStatus !== 8 && user.kycStatus !== kycState) ||
        user.employixScore !== currentScore)
    ) {
      await User.findByIdAndUpdate(userId, {
        $set: {
          aadhaarStatus: aadhaarDone ? 1 : 0,
          employmentStatus: employmentDone ? 1 : 0,
          voterStatus: voterDone ? 1 : 0,
          dlStatus: dlDone ? 1 : 0,
          kycStatus: user.kycStatus === 8 ? 8 : kycState,
          employixScore: currentScore,
          isVerified: aadhaarDone || voterDone || dlDone ? true : user.isVerified,
        },
      });
    }

    logger.info('KYC status retrieved successfully', {
      correlationId,
      userId,
      aadhaarDone,
      employmentDone,
      voterDone,
      dlDone,
      educationDone,
      panDone,
      currentScore,
      kycState,
    });

    return success(
      res,
      {
        aadhaarStatus: aadhaarDone ? 1 : 0,
        employmentStatus: employmentDone ? 1 : 0,
        voterStatus: voterDone ? 1 : 0,
        dlStatus: dlDone ? 1 : 0,
        educationStatus: eduVerified ? 1 : 0,
        panStatus: panDone ? 1 : 0,
        kycStatus: kycState,
        qualificationCount: qualCount || 0,
        certificationCount: certCount || 0,
        employixId: userEmployixId || user?.employixId,
        employixScore: currentScore,
        scoreBreakdown: {
          baseScore: 0,
          aadhaarBoost: aadhaarDone ? 20 : 0,
          voterBoost: voterDone ? 20 : 0,
          dlBoost: dlDone ? 5 : 0,
          employmentBoost: employmentDone ? 35 : 0,
          educationBoost: eduVerified ? 20 : 0,
          currentScore,
          tier: currentScore >= 80 ? 'Platinum Tier' : currentScore >= 60 ? 'Gold Tier' : currentScore >= 20 ? 'Silver Tier' : 'Base Profile',
        },
        aadhaarData: aadhaarRecord
          ? {
              maskedDocumentNumber: aadhaarRecord.maskedDocumentNumber,
              name: aadhaarRecord.name,
              dob: aadhaarRecord.dob,
              gender: aadhaarRecord.gender,
              address: aadhaarRecord.address,
              verificationMethod: aadhaarRecord.verificationMethod || 'ocr_scan',
              scoreEarned: aadhaarRecord.scoreEarned || 20,
              verifiedAt: aadhaarRecord.verifiedAt,
            }
          : null,
        voterData: voterRecord
          ? {
              maskedDocumentNumber: voterRecord.maskedDocumentNumber || 'WXD1****92',
              name: voterRecord.name,
              dob: voterRecord.dob,
              age: voterRecord.age,
              gender: voterRecord.gender,
              address: voterRecord.address,
              verificationMethod: voterRecord.verificationMethod || 'ocr_scan',
              scoreEarned: 20,
              verifiedAt: voterRecord.verifiedAt,
            }
          : null,
        dlData: dlRecord
          ? {
              maskedDocumentNumber: dlRecord.maskedDocumentNumber || 'DL04******2345',
              name: dlRecord.name,
              dob: dlRecord.dob,
              dateOfExpiry: dlRecord.dateOfExpiry,
              vehicleTypes: dlRecord.vehicleTypes,
              validity: dlRecord.validity,
              address: dlRecord.address,
              verificationMethod: 'ocr_scan',
              scoreEarned: 5,
              verifiedAt: dlRecord.verifiedAt,
            }
          : null,
        panData: panRecord
          ? {
              maskedDocumentNumber: panRecord.maskedDocumentNumber,
              name: panRecord.name,
              panStatus: panRecord.panStatus,
              verificationMethod: panRecord.verificationMethod || 'manual_number',
              scoreEarned: panRecord.scoreEarned || 20,
              isAadhaarPanLinked: panRecord.isAadhaarPanLinked,
              verifiedAt: panRecord.verifiedAt,
            }
          : null,
      },
      'KYC status fetched successfully'
    );
  } catch (err) {
    console.log("🚀 ~ getKycStatus ~ err:", err)
    const { statusCode, message } = resolveErrorInfo(err, 'Failed to fetch KYC status');
    logger.error('Failed to get KYC status', { correlationId, userId, statusCode, error: message });
    return serverError(res, message);
  }
};

const addQualification = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  try {
    const { degree, institution, year, grade } = req.body;
    const file = req.file;
    const record = await addQualificationService({
      userId,
      degree,
      institution,
      year,
      grade,
      file,
    });

    const { kycState, newScore, aadhaarDone, voterDone, dlDone, employmentDone } = await getFullUserKycState(userId);

    await User.findByIdAndUpdate(userId, {
      $set: {
        kycStatus: kycState,
        employixScore: newScore,
        aadhaarStatus: aadhaarDone ? 1 : 0,
        employmentStatus: employmentDone ? 1 : 0,
        voterStatus: voterDone ? 1 : 0,
        dlStatus: dlDone ? 1 : 0,
      },
    });

    return success(res, { record, kycStatus: kycState, employixScore: newScore }, 'Qualification added successfully');
  } catch (err) {
    logger.error('Failed to add qualification', { userId, error: err.message });
    return badRequest(res, err.message);
  }
};

const getQualifications = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  try {
    // Sanitize any manual qualifications to ensure unverified display
    await Qualification.updateMany(
      { userId, $or: [{ verificationMethod: 'Manual Upload' }, { badge: 'Self-Reported / Not Verified' }] },
      { $set: { isVerified: false, verificationStatus: 'unverified', badge: 'Self-Reported / Not Verified' } }
    );
    const records = await getQualificationsService(userId);
    return success(res, records, 'Qualifications fetched successfully');
  } catch (err) {
    logger.error('Failed to get qualifications', { userId, error: err.message });
    return serverError(res, err.message);
  }
};

const deleteQualification = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  const { id } = req.params;
  try {
    await deleteQualificationService(userId, id);
    const { kycState, newScore } = await getFullUserKycState(userId);
    await User.findByIdAndUpdate(userId, { $set: { kycStatus: kycState, employixScore: newScore } });

    return success(res, { kycStatus: kycState, employixScore: newScore }, 'Qualification deleted successfully');
  } catch (err) {
    logger.error('Failed to delete qualification', { userId, id, error: err.message });
    return badRequest(res, err.message);
  }
};

const addCertification = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  try {
    const { title, issuer, year, credentialId, credentialUrl } = req.body;
    const file = req.file;
    const record = await addCertificationService({
      userId,
      title,
      issuer,
      year,
      credentialId,
      credentialUrl,
      file,
    });

    const { kycState, newScore, aadhaarDone, voterDone, dlDone, employmentDone } = await getFullUserKycState(userId);

    await User.findByIdAndUpdate(userId, {
      $set: {
        kycStatus: kycState,
        employixScore: newScore,
        aadhaarStatus: aadhaarDone ? 1 : 0,
        employmentStatus: employmentDone ? 1 : 0,
        voterStatus: voterDone ? 1 : 0,
        dlStatus: dlDone ? 1 : 0,
      },
    });

    return success(res, { record, kycStatus: kycState, employixScore: newScore }, 'Certification added successfully');
  } catch (err) {
    logger.error('Failed to add certification', { userId, error: err.message });
    return badRequest(res, err.message);
  }
};

const getCertifications = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  try {
    // Sanitize any manual certifications to ensure unverified display
    await Certification.updateMany(
      { userId, $or: [{ verificationMethod: 'Manual Upload' }, { badge: 'Self-Reported / Not Verified' }, { credentialUrl: { $exists: true } }] },
      { $set: { isVerified: false, verificationStatus: 'unverified', badge: 'Self-Reported / Not Verified' } }
    );
    const records = await getCertificationsService(userId);
    return success(res, records, 'Certifications fetched successfully');
  } catch (err) {
    logger.error('Failed to get certifications', { userId, error: err.message });
    return serverError(res, err.message);
  }
};

const deleteCertification = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  const { id } = req.params;
  try {
    await deleteCertificationService(userId, id);
    const { kycState, newScore } = await getFullUserKycState(userId);
    await User.findByIdAndUpdate(userId, { $set: { kycStatus: kycState, employixScore: newScore } });

    return success(res, { kycStatus: kycState, employixScore: newScore }, 'Certification deleted successfully');
  } catch (err) {
    logger.error('Failed to delete certification', { userId, id, error: err.message });
    return badRequest(res, err.message);
  }
};

const completeKycSetup = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await User.findById(userId);
    if (!user) return badRequest(res, 'User not found');

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: { kycStatus: 8, isVerified: true } },
      { new: true }
    ).select('-password');

    return success(
      res,
      { user: updatedUser, kycStatus: 8, isVerified: true },
      'Setup completed successfully (Status 8)'
    );
  } catch (err) {
    return serverError(res, err);
  }
};

module.exports = {
  verifyAadhaarDocument,
  verifyPanDocument,
  extractPanOcrDocument,
  verifyVoterId,
  processVoterOcr,
  getEmploymentHistory,
  getEmploymentByUan,
  addManualEmployment,
  getManualEmployments,
  deleteManualEmployment,
  processDlOcr,
  getKycStatus,
  addQualification,
  getQualifications,
  deleteQualification,
  addCertification,
  getCertifications,
  deleteCertification,
  completeKycSetup,
};