const {
  registerUser,
  verifyOTP,
  checkEmailPassword,
  resendUserOtp,
  logoutService,
  forgotPasswordService,
  resetPasswordService,
  getCurrentUserService,
} = require("./auth.service");
const {
  success,
  created,
  badRequest,
  unauthorized,
  serverError,
} = require("../../utils/response");
const {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  resendOtpSchema,
} = require("../../validation/authValidation");
const { generateToken } = require("../../utils/jwt");
const logger = require("../../utils/logger");

const register = async (req, res) => {
  try {
    const { error, value } = registerSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(", ");
      logger.error(`Register validation failed (Bad Request): ${errorMessage}`);
      return badRequest(res, errorMessage);
    }

    const result = await registerUser(value);
    return created(
      res,
      result,
      "User registered successfully. OTP sent to email.",
    );
  } catch (err) {
    logger.error("Service error in register controller:", err);
    if (
      err.message === 'Email already registered' ||
      err.message === 'Phone number already registered'
    ) {
      return badRequest(res, err.message);
    }
    return serverError(res, err);
  }
};

const verify = async (req, res) => {
  try {
    const { value, error } = await verifyOtpSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(", ");
      logger.error(`Verify OTP validation failed (Bad Request): ${errorMessage}`);
      return badRequest(res, errorMessage);
    }

    const result = await verifyOTP({ email: value.email, otp: value.otp });
    return success(res, result, "Account verified successfully");
  } catch (err) {
    logger.warn(`Verify OTP failed: ${err.message}`);
    return badRequest(res, err.message || "Invalid or expired OTP");
  }
};

const login = async (req, res) => {
  try {
    const { error, value } = loginSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(", ");
      logger.error(`Login validation failed (Bad Request): ${errorMessage}`);
      return badRequest(res, errorMessage);
    }

    const user = await checkEmailPassword(value.email);
    if (!user) {
      logger.error(`Login failed: Invalid credentials for email -> ${value.email}`);
      return unauthorized(res, "Invalid credentials");
    }

    return success(res, user, "Sucessfully logged in");
  } catch (err) {
    console.log("emdkemdkemdke",err)
    logger.error("Service error in login controller:", err);
    return serverError(res, err);
  }
};

const resendOtp = async (req, res) => {
  try {
    const { error, value } = resendOtpSchema.validate(req.body, {
      abortEarly: false,
    });

    if (error) {
      const errorMessage = error.details.map((d) => d.message).join(", ");
      logger.error(`Resend OTP validation failed (Bad Request): ${errorMessage}`);
      return badRequest(res, errorMessage);
    }

    const result = await resendUserOtp(value.email);
    return success(res, result, "New OTP sent successfully to your email");
  } catch (err) {
    logger.error("Service error in resendOtp controller:", err.message);
    return badRequest(res, err.message || "Failed to resend OTP");
  }
};

const logout = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await logoutService(userId);

    return success(res, user, "Logged out successfully");
  } catch (err) {
    logger.error("Service error in logout controller:", err);
    return serverError(res, err);
  }
};

const getCurrentUser = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const user = await getCurrentUserService(userId);

    return success(res, user, "Current user profile fetched successfully");
  } catch (err) {
    logger.error("Service error in getCurrentUser controller:", err);
    return serverError(res, err);
  }
};

const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;

    if (!email) {
      logger.error("Forgot password validation failed (Bad Request): Email is required");
      return badRequest(res, "Email is required");
    }

    await forgotPasswordService(email);

    return success(
      res,
      "If this email is registered, a password reset link has been sent.",
    );
  } catch (error) {
    logger.error("Service error in forgotPassword controller:", error);
    return serverError(res, error);
  }
};

const showResetPasswordPage = async (req, res, next) => {
  try {
    const { token } = req.params;

    if (!token) {
      const err = new Error("Reset token is required");
      logger.error("Bad Request in showResetPasswordPage:", err);
      throw err;
    }

    return res.render("reset-password", {
      token,
    });
  } catch (error) {
    logger.error("Error in showResetPasswordPage controller:", error);
    next(error);
  }
};

const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword } = req.body;

    if (!token) {
      logger.error("Reset password failed (Bad Request): Reset token is missing");
      return badRequest(res, "Reset token is required");
    }

    if (!newPassword) {
      logger.error("Reset password failed (Bad Request): New password is missing");
      return badRequest(res, "New password is required");
    }

    if (newPassword.length < 8) {
      logger.error("Reset password failed (Bad Request): Password length is less than 8 characters");
      return badRequest(res, "Password must be at least 8 characters");
    }

    await resetPasswordService(token, newPassword);

    return success(res, "Password has been reset successfully");
  } catch (error) {
    logger.error("Service error in resetPassword controller:", error);
    return serverError(res, error);
  }
};

module.exports = {
  register,
  verify,
  login,
  resendOtp,
  logout,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  showResetPasswordPage,
};