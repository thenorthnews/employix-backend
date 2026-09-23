const express = require('express');
const router = express.Router();

const {
  verifyAadhaarDocument,
  verifyPanDocument,
  extractPanOcrDocument,
  verifyVoterId,
  processVoterOcr,
  getEmploymentHistory,
  getEmploymentByUan,
  processDlOcr,
  getKycStatus,
  getManualEmployments,
  addManualEmployment,
  deleteManualEmployment,
  addQualification,
  getQualifications,
  deleteQualification,
  addCertification,
  getCertifications,
  deleteCertification,
  completeKycSetup,
} = require('./verification/controllers/verification.controller');
const {
  addReference,
  getReferences,
  resendInvitation,
  getShareLink,
  validateToken,
  sendOtp,
  verifyOtp,
  submitFeedback,
} = require('./referral/controllers/referral.controller');
const { requireAuth } = require('../../middleware/auth');
const { uploadVerificationDocs, uploadDocument } = require('../../common/uploads/uploadMulture');
const { kycLimiter } = require('../../middleware/rateLimiter');

// --- Public Reference Verification Endpoints (Accessed by referee via email link) ---
router.get('/references/verify-token', validateToken);
router.post('/references/send-otp', sendOtp);
router.post('/references/verify-otp', verifyOtp);
router.post('/references/submit-feedback', submitFeedback);

router.use(requireAuth);
// router.use(kycLimiter);


// Aadhaar Flow (OCR Multipart Scan)
router.post(
  '/kyc/aadhaar',
  uploadVerificationDocs.fields([
    { name: 'documentFront', maxCount: 1 },
    { name: 'documentBack', maxCount: 1 },
  ]),
  verifyAadhaarDocument
);

// PAN Flows
router.post('/kyc/pan', verifyPanDocument);
router.post(
  '/kyc/pan/ocr',
  uploadVerificationDocs.fields([{ name: 'panImage', maxCount: 1 }]),
  extractPanOcrDocument
);

router.post('/kyc/voter', verifyVoterId);
router.post(
  '/kyc/voter/ocr', 
  uploadVerificationDocs.fields([
    { name: 'documentFront', maxCount: 1 },
    { name: 'documentBack', maxCount: 1 },
  ]),
  processVoterOcr
);
router.post('/kyc/employment-history', getEmploymentHistory);
router.post('/kyc/employment-history/uan', getEmploymentByUan);
router.post(
  '/kyc/dl/ocr', 
  uploadVerificationDocs.fields([
    { name: 'documentFront', maxCount: 1 },
    { name: 'documentBack', maxCount: 1 },
  ]),
  processDlOcr
);
router.get('/kyc/employment-records', getManualEmployments);
router.post('/kyc/employment/manual', addManualEmployment);
router.delete('/kyc/employment/manual/:id', deleteManualEmployment);

// Separate Collections: Qualifications & Certifications
router.get('/qualifications', getQualifications);
router.post('/qualifications', uploadDocument.single('document'), addQualification);
router.delete('/qualifications/:id', deleteQualification);

router.get('/certifications', getCertifications);
router.post('/certifications', uploadDocument.single('document'), addCertification);
router.delete('/certifications/:id', deleteCertification);

// --- Candidate Reference Management (Requires Candidate Auth) ---
router.post('/references', addReference);
router.get('/references', getReferences);
router.post('/references/:id/resend', resendInvitation);
router.get('/references/:id/share-link', getShareLink);

// KYC Status Retrieval & Completion
router.get('/kyc/status', getKycStatus);
router.post('/kyc/complete-setup', completeKycSetup);
module.exports = router;