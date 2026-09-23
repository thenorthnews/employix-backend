const { parentPort } = require('worker_threads');
const {
  sendOTPEmail,
  sendForgotPasswordEmail,
  sendPasswordResetSuccessEmail,
  sendReferenceInvitationEmail,
  sendReferenceOtpEmail,
} = require('../utils/email');

if (parentPort) {
  parentPort.on('message', async (data) => {
  try {
    const {
      type,
      email,
      name,
      otp,
      resetUrl,
      candidateName,
      candidateRole,
      verificationUrl,
    } = data;

    if (type === 'otp') {
      await sendOTPEmail(email, name, otp);
    }

    if (type === 'reference-invitation') {
      await sendReferenceInvitationEmail(email, name, candidateName, candidateRole, verificationUrl);
    }

    if (type === 'reference-otp') {
      await sendReferenceOtpEmail(email, name, candidateName, otp);
    }

    if (type === 'reset-password') {
      await sendForgotPasswordEmail(email, name, resetUrl);
    }

    if (type === 'password-reset-success') {
      await sendPasswordResetSuccessEmail(email, name);
    }
        parentPort.postMessage({ status: 'success' });
    } catch (error) {
        parentPort.postMessage({ status: 'error', message: error.message });
    }
  });
}