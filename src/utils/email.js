const nodemailer = require('nodemailer');

const cleanPass = process.env.EMAIL_PASS ? String(process.env.EMAIL_PASS).replace(/\s+/g, '') : '';

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT, 10) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER ? process.env.EMAIL_USER.trim() : '',
    pass: cleanPass,
  },
});

const sendOTPEmail = async (toEmail, name, otpCode) => {
  const mailOptions = {
    from: `"EMPLOYIX Security" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `EMPLOYIX - Your Verification Code is ${otpCode}`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 25px; color: #1e293b; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #0b2545; margin-bottom: 8px;">Hello ${name || 'User'},</h2>
        <p style="color: #64748b; font-size: 15px;">Your requested one-time verification code for <strong>EMPLOYIX</strong> is:</p>
        <div style="text-align: center; margin: 25px 0;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #00D294; background: #f0fdf9; padding: 14px 28px; border-radius: 8px; border: 1px dashed #00D294; display: inline-block;">
            ${otpCode}
          </span>
        </div>
        <p style="color: #64748b; font-size: 14px;">This code expires in <strong>10 minutes</strong>. Do not share this code with anyone.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">EMPLOYIX Candidate & Employer Verification Platform</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [EMAIL SENT SUCCESSFULLY] To: ${toEmail} | OTP: ${otpCode} | MsgID: ${info.messageId}`);
    return info;
  } catch (err) {
    console.error(`❌ [EMAIL SENDING FAILED] To: ${toEmail} | Error:`, err.message);
    throw err;
  }
};

 const sendWelcomeEmail = async (toEmail, name) => {
  const mailOptions = {
    from: `"EMPLOYIX Team" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Welcome to EMPLOYIX!',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Welcome aboard, ${name}! 🎉</h2>
        <p>Your account has been successfully created and verified.</p>
        <p>We are excited to have you with us.</p>
      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

const sendForgotPasswordEmail = async (toEmail, name, resetUrl) => {
  const mailOptions = {
    from: `"EMPLOYIX Team" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Reset Your EMPLOYIX Password",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">

        <h2>Hello ${name},</h2>

        <p>
          We received a request to reset your EMPLOYIX account password.
        </p>

        <p>
          Click the button below to create a new password:
        </p>

        <div style="margin: 25px 0;">
          <a
            href="${resetUrl}"
            style="
              display: inline-block;
              padding: 12px 24px;
              background-color: #0b2545;
              color: #ffffff;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
            "
          >
            Reset Password
          </a>
        </div>

        <p>
          This password reset link will expire in <strong>15 minutes</strong>.
        </p>

        <p>
          If you did not request a password reset, you can safely ignore this email.
        </p>

        <p>
          Regards,<br />
          <strong>EMPLOYIX Team</strong>
        </p>

      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};
const sendPasswordResetSuccessEmail = async (toEmail, name) => {
  const mailOptions = {
    from: `"EMPLOYIX Team" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: "Your EMPLOYIX Password Has Been Reset",
    html: `
      <div style="
        font-family: Arial, sans-serif;
        padding: 20px;
        color: #333;
        max-width: 600px;
        margin: auto;
      ">

        <h2 style="color: #0b2545;">
          Hello ${name},
        </h2>

        <p>
          Your EMPLOYIX account password has been
          successfully reset.
        </p>

        <p>
          You can now log in to your account using your
          new password.
        </p>

        <div style="margin: 25px 0;">
          <a
            href="${process.env.FRONTEND_URL}/login"
            style="
              display: inline-block;
              padding: 12px 24px;
              background-color: #0b2545;
              color: #ffffff;
              text-decoration: none;
              border-radius: 5px;
              font-weight: bold;
            "
          >
            Login to EMPLOYIX
          </a>
        </div>

        <p>
          If you did not make this change, please contact
          the EMPLOYIX support team immediately.
        </p>

        <p>
          Regards,<br />
          <strong>EMPLOYIX Team</strong>
        </p>

      </div>
    `,
  };

  return await transporter.sendMail(mailOptions);
};

const sendReferenceInvitationEmail = async (refereeEmail, refereeName, candidateName, candidateRole, verificationUrl) => {
  const mailOptions = {
    from: `"EMPLOYIX Verification" <${process.env.EMAIL_USER}>`,
    to: refereeEmail,
    subject: `Professional Reference Request for ${candidateName} - EMPLOYIX`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 28px; color: #1e293b; max-width: 540px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 14px; background: #ffffff;">
        <div style="display: flex; align-items: center; margin-bottom: 20px;">
          <h2 style="color: #0b2545; margin: 0; font-size: 22px;">EMPLOYIX <span style="color: #00D294;">Verification</span></h2>
        </div>
        <h3 style="color: #0f172a; margin-top: 0; margin-bottom: 12px;">Hello ${refereeName || 'Colleague'},</h3>
        <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
          <strong>${candidateName}</strong>${candidateRole ? ` (${candidateRole})` : ''} has listed you as a professional reference on their <strong>EMPLOYIX Verified Trust Profile</strong>.
        </p>
        <p style="color: #475569; font-size: 14px; line-height: 1.5; margin-bottom: 24px;">
          Please take 2 minutes to provide brief confidential feedback regarding your professional experience working together.
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <a
            href="${verificationUrl}"
            target="_blank"
            style="
              background-color: #00D294;
              color: #ffffff;
              padding: 14px 32px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 700;
              font-size: 15px;
              display: inline-block;
              box-shadow: 0 4px 12px rgba(0, 210, 148, 0.3);
            "
          >
            Review &amp; Verify Reference &rarr;
          </a>
        </div>
        <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 24px;">
          When you click the link, you will receive a one-time verification code on this email to securely verify your identity before submitting feedback.
        </p>
        <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
          This link is secure, unique to you, and will expire in <strong>7 days</strong>.
        </p>
        <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 22px 0;" />
        <p style="color: #94a3b8; font-size: 11px; margin: 0;">
          EMPLOYIX Candidate Trust &amp; Employment Verification Platform
        </p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [REFERENCE INVITATION SENT] To: ${refereeEmail} | Candidate: ${candidateName}`);
    return info;
  } catch (err) {
    console.error(`❌ [REFERENCE INVITATION FAILED] To: ${refereeEmail} | Error:`, err.message);
    throw err;
  }
};

const sendReferenceOtpEmail = async (refereeEmail, refereeName, candidateName, otpCode) => {
  const mailOptions = {
    from: `"EMPLOYIX Verification Security" <${process.env.EMAIL_USER}>`,
    to: refereeEmail,
    subject: `EMPLOYIX Verification Code: ${otpCode} (Reference for ${candidateName})`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 25px; color: #1e293b; max-width: 500px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <h2 style="color: #0b2545; margin-bottom: 8px;">Hello ${refereeName || 'Colleague'},</h2>
        <p style="color: #64748b; font-size: 14px; margin-bottom: 18px;">
          Your one-time security code to verify professional feedback for <strong>${candidateName}</strong> on EMPLOYIX is:
        </p>
        <div style="text-align: center; margin: 22px 0;">
          <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #00D294; background: #f0fdf9; padding: 14px 28px; border-radius: 8px; border: 1px dashed #00D294; display: inline-block;">
            ${otpCode}
          </span>
        </div>
        <p style="color: #64748b; font-size: 13px;">This code is valid for <strong>10 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
        <p style="color: #94a3b8; font-size: 12px; margin: 0;">EMPLOYIX Candidate Trust &amp; Employment Verification</p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ [REFERENCE OTP SENT] To: ${refereeEmail} | OTP: ${otpCode}`);
    return info;
  } catch (err) {
    console.error(`❌ [REFERENCE OTP FAILED] To: ${refereeEmail} | Error:`, err.message);
    throw err;
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendForgotPasswordEmail,
  sendPasswordResetSuccessEmail,
  sendReferenceInvitationEmail,
  sendReferenceOtpEmail,
};