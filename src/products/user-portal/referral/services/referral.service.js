const crypto = require('crypto');
const path = require('path');
const { Worker } = require('worker_threads');
const Referral = require('../../models/referral.model');
const ReferralFeedback = require('../../models/referralFeedback.model');
const RewardTransaction = require('../../models/rewardTransaction.model');
const User = require('../../../../common/users/user.model');
const { getLatestCandidateCompany } = require('../../verification/helpers/epfoEmploymentHelper');
const { calculateReferenceScores } = require('../../../../utils/referenceScoreCalculator');

const CLIENT_APP_URL = process.env.CLIENT_APP_URL || 'http://localhost:5173';

const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Dispatch background email via existing worker thread
 */
const dispatchEmailWorker = (payload) => {
  try {
    const workerPath = path.join(__dirname, '../../../../workers/emailWorker.js');
    const worker = new Worker(workerPath);
    worker.postMessage(payload);
    worker.on('message', (message) => {
      console.log('✅ [Email Worker Reference]:', message);
    });
    worker.on('error', (error) => {
      console.error('❌ [Email Worker Reference Error]:', error);
    });
    worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Email Worker stopped with exit code ${code}`);
      }
    });
  } catch (err) {
    console.error('Failed to spawn email worker:', err);
  }
};

const NAME_REGEX = /^[a-zA-Z\s.']{2,50}$/;
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const ROLE_REGEX = /^[a-zA-Z0-9\s/.,&()'-]{2,60}$/;

/**
 * 1. Create a professional reference invitation & send email via worker thread
 */
const createReferenceInvitation = async ({ referrerId, refereeName, refereeEmail, refereeRole }) => {
  const candidate = await User.findById(referrerId);
  if (!candidate) {
    throw new Error('Candidate account not found');
  }

  // Strict regex validation
  if (!refereeName || !NAME_REGEX.test(refereeName.trim())) {
    throw new Error('Please enter a valid referee full name (2-50 letters/spaces).');
  }

  const cleanRefereeEmail = refereeEmail ? refereeEmail.trim().toLowerCase() : '';
  if (!cleanRefereeEmail || !EMAIL_REGEX.test(cleanRefereeEmail)) {
    throw new Error('Please enter a valid referee email address.');
  }

  if (!refereeRole || !ROLE_REGEX.test(refereeRole.trim())) {
    throw new Error('Please enter a valid referee role or designation (2-60 characters).');
  }

  if (cleanRefereeEmail === candidate.email.toLowerCase()) {
    throw new Error('You cannot add your own email address as a professional reference.');
  }

  // Check limit (Maximum 2 professional references per candidate)
  const currentCount = await Referral.countDocuments({ referrerId });
  if (currentCount >= 2) {
    throw new Error('Maximum 2 professional references are allowed.');
  }

  // Check duplicate invitation to same referee email
  const existing = await Referral.findOne({ referrerId, refereeEmail: cleanRefereeEmail });
  if (existing) {
    throw new Error('A reference invitation has already been added for this email address.');
  }

  // Generate secure 32-byte token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const referral = await Referral.create({
    referrerId,
    refereeName: refereeName.trim(),
    refereeEmail: cleanRefereeEmail,
    refereeRole: refereeRole.trim(),
    tokenHash,
    rawToken,
    tokenExpiry,
    status: 'invitation_sent',
  });

  // Dispatch Invitation Email via Worker Thread
  const verificationUrl = `${CLIENT_APP_URL}/reference-verification?token=${rawToken}`;
  dispatchEmailWorker({
    type: 'reference-invitation',
    email: cleanRefereeEmail,
    name: referral.refereeName,
    candidateName: candidate.name,
    candidateRole: candidate.designation || 'Candidate',
    verificationUrl,
  });

  return {
    _id: referral._id,
    refereeName: referral.refereeName,
    refereeEmail: referral.refereeEmail,
    refereeRole: referral.refereeRole,
    status: referral.status,
    isFeedbackSubmitted: referral.isFeedbackSubmitted,
    isPointsAwarded: referral.isPointsAwarded,
    shareableLink: verificationUrl,
    createdAt: referral.createdAt,
  };
};

/**
 * 2. Get all references, reward points balance, and transactions for candidate
 */
const getUserReferences = async (referrerId) => {
  const [candidate, references, rewardTransactions] = await Promise.all([
    User.findById(referrerId).select('rewardPoints name designation email').lean(),
    Referral.find({ referrerId }).sort({ createdAt: -1 }).lean(),
    RewardTransaction.find({ userId: referrerId }).sort({ createdAt: -1 }).lean(),
  ]);

  // Attach feedback summary if completed
  const populatedReferences = await Promise.all(
    references.map(async (ref) => {
      let feedback = null;
      if (ref.isFeedbackSubmitted) {
        feedback = await ReferralFeedback.findOne({ referralId: ref._id }).lean();
      }
      const shareableLink = ref.rawToken && !ref.isFeedbackSubmitted
        ? `${CLIENT_APP_URL}/reference-verification?token=${ref.rawToken}`
        : null;

      return {
        _id: ref._id,
        refereeName: ref.refereeName,
        refereeEmail: ref.refereeEmail,
        refereeRole: ref.refereeRole,
        status: ref.status,
        isOtpVerified: ref.isOtpVerified,
        isFeedbackSubmitted: ref.isFeedbackSubmitted,
        isPointsAwarded: ref.isPointsAwarded,
        createdAt: ref.createdAt,
        shareableLink,
        feedback,
      };
    })
  );

  const scoreMetrics = calculateReferenceScores(populatedReferences);

  return {
    references: populatedReferences,
    rewardPoints: candidate?.rewardPoints || 0,
    rewardTransactions,
    maxReferencesAllowed: 2,
    completedCount: populatedReferences.filter((r) => r.isFeedbackSubmitted).length,
    ...scoreMetrics,
  };
};

/**
 * 3. Resend invitation email via Worker Thread
 */
const resendReferenceInvitation = async (referrerId, referenceId) => {
  const candidate = await User.findById(referrerId);
  const referral = await Referral.findOne({ _id: referenceId, referrerId });

  if (!referral) {
    throw new Error('Reference record not found.');
  }

  if (referral.isFeedbackSubmitted || referral.status === 'completed') {
    throw new Error('This reference has already been completed.');
  }

  // Generate fresh token
  const rawToken = crypto.randomBytes(32).toString('hex');
  referral.tokenHash = hashToken(rawToken);
  referral.rawToken = rawToken;
  referral.tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  referral.otpHash = null;
  referral.otpExpiry = null;
  referral.otpAttempts = 0;
  referral.isOtpVerified = false;
  referral.status = 'invitation_sent';
  await referral.save();

  const verificationUrl = `${CLIENT_APP_URL}/reference-verification?token=${rawToken}`;
  dispatchEmailWorker({
    type: 'reference-invitation',
    email: referral.refereeEmail,
    name: referral.refereeName,
    candidateName: candidate.name,
    candidateRole: candidate.designation || 'Candidate',
    verificationUrl,
  });

  return {
    message: `Invitation email resent successfully to ${referral.refereeEmail}`,
    shareableLink: verificationUrl,
  };
};

/**
 * Get or generate shareable link for reference
 */
const getReferenceShareLink = async (referrerId, referenceId) => {
  const referral = await Referral.findOne({ _id: referenceId, referrerId });
  if (!referral) {
    throw new Error('Reference record not found.');
  }
  if (referral.isFeedbackSubmitted || referral.status === 'completed') {
    throw new Error('This reference has already been completed.');
  }

  let rawToken = referral.rawToken;
  if (!rawToken || referral.tokenExpiry < new Date()) {
    rawToken = crypto.randomBytes(32).toString('hex');
    referral.rawToken = rawToken;
    referral.tokenHash = hashToken(rawToken);
    referral.tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await referral.save();
  }

  const shareableLink = `${CLIENT_APP_URL}/reference-verification?token=${rawToken}`;
  return {
    referenceId: referral._id,
    refereeName: referral.refereeName,
    refereeEmail: referral.refereeEmail,
    shareableLink,
  };
};

/**
 * 4. Validate verification token (Public)
 */
const validateVerificationToken = async (rawToken) => {
  if (!rawToken) {
    throw new Error('Verification token is required.');
  }

  const tokenHash = hashToken(rawToken);
  const referral = await Referral.findOne({ tokenHash }).populate('referrerId', 'name designation');

  if (!referral) {
    throw new Error('Invalid verification link. Please request a new invitation.');
  }

  if (referral.tokenExpiry < new Date()) {
    referral.status = 'expired';
    await referral.save();
    throw new Error('This verification link has expired (valid for 7 days).');
  }

  const candidateId = referral.referrerId?._id || referral.referrerId;
  const companyInfo = await getLatestCandidateCompany(candidateId);
  const companyName = companyInfo?.companyName || 'your organization';

  return {
    referralId: referral._id,
    candidateName: referral.referrerId?.name || 'Candidate',
    candidateRole: referral.referrerId?.designation || 'Candidate',
    companyName,
    latestCompanyName: companyName,
    joiningDate: companyInfo?.joiningDate || null,
    exitDate: companyInfo?.exitDate || null,
    isCurrent: Boolean(companyInfo?.isCurrent),
    allCompanies: companyInfo?.allCompanies || [],
    source: companyInfo?.source || 'NONE',
    refereeName: referral.refereeName,
    refereeEmail: referral.refereeEmail,
    refereeRole: referral.refereeRole,
    status: referral.status,
    isOtpVerified: referral.isOtpVerified,
    isFeedbackSubmitted: referral.isFeedbackSubmitted,
  };
};

/**
 * 5. Send 6-digit Email OTP to referee via Worker Thread (Public)
 */
const sendRefereeEmailOtp = async (rawToken) => {
  if (!rawToken) {
    throw new Error('Verification token is required.');
  }

  const tokenHash = hashToken(rawToken);
  const referral = await Referral.findOne({ tokenHash }).populate('referrerId', 'name');

  if (!referral) {
    throw new Error('Invalid or expired verification link.');
  }

  if (referral.isFeedbackSubmitted || referral.status === 'completed') {
    throw new Error('Feedback has already been submitted for this reference.');
  }

  if (referral.tokenExpiry < new Date()) {
    throw new Error('This verification link has expired.');
  }

  // Generate 6-digit OTP
  const otpCode = crypto.randomInt(100000, 999999).toString();
  referral.otpHash = hashToken(otpCode);
  referral.otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  referral.otpAttempts = 0;
  await referral.save();

  dispatchEmailWorker({
    type: 'reference-otp',
    email: referral.refereeEmail,
    name: referral.refereeName,
    candidateName: referral.referrerId?.name || 'Candidate',
    otp: otpCode,
  });

  return {
    message: `A 6-digit verification code has been sent to ${referral.refereeEmail}`,
    expiresInSeconds: 600,
  };
};

/**
 * 6. Verify 6-digit Email OTP (Public)
 */
const verifyRefereeEmailOtp = async (rawToken, otpCode) => {
  if (!rawToken || !otpCode) {
    throw new Error('Token and OTP code are required.');
  }

  const cleanOtp = String(otpCode).trim();
  if (cleanOtp.length !== 6) {
    throw new Error('Please enter a valid 6-digit OTP.');
  }

  const tokenHash = hashToken(rawToken);
  const referral = await Referral.findOne({ tokenHash });

  if (!referral) {
    throw new Error('Invalid verification session.');
  }

  if (referral.isFeedbackSubmitted) {
    throw new Error('Feedback has already been submitted for this reference.');
  }

  if (!referral.otpExpiry || referral.otpExpiry < new Date()) {
    throw new Error('Verification code has expired. Please request a new OTP.');
  }

  if (referral.otpAttempts >= 5) {
    throw new Error('Maximum verification attempts exceeded. Please request a new OTP.');
  }

  const inputHash = hashToken(cleanOtp);
  if (inputHash !== referral.otpHash) {
    referral.otpAttempts += 1;
    await referral.save();
    const remaining = 5 - referral.otpAttempts;
    throw new Error(`Invalid verification code. ${remaining} attempt(s) remaining.`);
  }

  // OTP is valid
  referral.isOtpVerified = true;
  referral.status = 'otp_verified';
  referral.otpHash = null; // Clear OTP once verified
  referral.otpExpiry = null;
  await referral.save();

  const candidate = await User.findById(referral.referrerId).select('name designation');
  const companyInfo = await getLatestCandidateCompany(referral.referrerId);
  const companyName = companyInfo?.companyName || 'your organization';

  return {
    isOtpVerified: true,
    candidateName: candidate?.name || 'Candidate',
    candidateRole: candidate?.designation || 'Candidate',
    companyName,
    latestCompanyName: companyName,
    joiningDate: companyInfo?.joiningDate || null,
    exitDate: companyInfo?.exitDate || null,
    isCurrent: Boolean(companyInfo?.isCurrent),
    allCompanies: companyInfo?.allCompanies || [],
    source: companyInfo?.source || 'NONE',
    message: 'Identity verified successfully. You can now submit your professional feedback.',
  };
};

/**
 * 7. Submit Feedback & Award +5 Reward Points (Public)
 * Handles Section A (Employment Confirmation) and Section B (Conduct 1-10 Soft Skills Evaluation)
 */
const submitRefereeFeedback = async (
  rawToken,
  {
    workedTogether = 'Yes',
    companyName = '',
    startDate = null,
    endDate = null,
    isCurrentlyWorking = false,
    diligence = 8,
    enthusiasm = 8,
    respectfulness = 8,
    relationship = 'Colleague',
    rating,
    feedback = '',
    recommendation = 'Yes',
  } = {}
) => {
  if (!rawToken) {
    throw new Error('Verification token is required.');
  }

  const tokenHash = hashToken(rawToken);
  const referral = await Referral.findOne({ tokenHash }).populate('referrerId', 'name email rewardPoints');

  if (!referral) {
    throw new Error('Invalid verification session.');
  }

  if (!referral.isOtpVerified) {
    throw new Error('Please verify your email security code first before submitting feedback.');
  }

  if (referral.isFeedbackSubmitted || referral.status === 'completed') {
    throw new Error('Feedback has already been submitted for this reference. Thank you!');
  }

  // Section B soft skills validation (1 to 10 scale)
  const numDiligence = Math.min(10, Math.max(1, Number(diligence) || 8));
  const numEnthusiasm = Math.min(10, Math.max(1, Number(enthusiasm) || 8));
  const numRespectfulness = Math.min(10, Math.max(1, Number(respectfulness) || 8));

  // Compute 5-star equivalent rating if not provided
  const computedRating =
    typeof rating === 'number' && rating >= 1 && rating <= 5
      ? rating
      : Math.round(((numDiligence + numEnthusiasm + numRespectfulness) / 30) * 5);

  const cleanWorkedTogether = ['Yes', 'No'].includes(workedTogether) ? workedTogether : 'Yes';
  const cleanRecommendation = ['Yes', 'No'].includes(recommendation) ? recommendation : 'Yes';

  // Construct feedback text if not provided
  let cleanFeedback = feedback ? String(feedback).trim() : '';
  if (!cleanFeedback) {
    cleanFeedback = `Verified performance evaluation: Diligence ${numDiligence}/10, Enthusiasm ${numEnthusiasm}/10, Respectfulness ${numRespectfulness}/10. Worked together: ${cleanWorkedTogether}.`;
  }

  // Create feedback record
  await ReferralFeedback.create({
    referralId: referral._id,
    referrerId: referral.referrerId._id,
    workedTogether: cleanWorkedTogether,
    companyName: companyName ? String(companyName).trim() : '',
    startDate: startDate ? String(startDate).trim() : null,
    endDate: isCurrentlyWorking ? null : (endDate ? String(endDate).trim() : null),
    isCurrentlyWorking: Boolean(isCurrentlyWorking),
    diligence: numDiligence,
    enthusiasm: numEnthusiasm,
    respectfulness: numRespectfulness,
    relationship: relationship ? String(relationship).trim() : 'Colleague',
    rating: computedRating,
    feedback: cleanFeedback,
    recommendation: cleanRecommendation,
    submittedAt: new Date(),
  });

  // Mark Referral Completed and Award Points
  referral.isFeedbackSubmitted = true;
  referral.status = 'completed';
  referral.isPointsAwarded = true;
  await referral.save();

  // Atomically award +5 reward points to candidate
  await User.findByIdAndUpdate(referral.referrerId._id, {
    $inc: { rewardPoints: 5 },
  });

  // Record Reward Transaction
  await RewardTransaction.create({
    userId: referral.referrerId._id,
    referralId: referral._id,
    points: 5,
    type: 'credit',
    description: `Professional Reference Verified by ${referral.refereeName} (+5 Points)`,
  });

  return {
    completed: true,
    message: 'Thank you! Your professional reference feedback has been submitted successfully.',
    candidateName: referral.referrerId?.name || 'Candidate',
    pointsAwarded: 5,
  };
};

module.exports = {
  createReferenceInvitation,
  getUserReferences,
  resendReferenceInvitation,
  getReferenceShareLink,
  validateVerificationToken,
  sendRefereeEmailOtp,
  verifyRefereeEmailOtp,
  submitRefereeFeedback,
};
