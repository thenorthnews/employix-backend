const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    refereeName: {
      type: String,
      required: true,
      trim: true,
    },
    refereeEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    refereeRole: {
      type: String,
      required: true,
      trim: true,
    },
    tokenHash: {
      type: String,
      required: true,
      index: true,
    },
    rawToken: {
      type: String,
      default: null,
    },
    tokenExpiry: {
      type: Date,
      required: true,
    },
    otpHash: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    otpAttempts: {
      type: Number,
      default: 0,
    },
    isOtpVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['invitation_sent', 'otp_verified', 'completed', 'expired'],
      default: 'invitation_sent',
    },
    isFeedbackSubmitted: {
      type: Boolean,
      default: false,
    },
    isPointsAwarded: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate active reference invites to same referee by same referrer
referralSchema.index({ referrerId: 1, refereeEmail: 1 }, { unique: true });

module.exports = mongoose.model('Referral', referralSchema);
