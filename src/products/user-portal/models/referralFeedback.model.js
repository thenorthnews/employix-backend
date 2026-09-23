const mongoose = require('mongoose');

const referralFeedbackSchema = new mongoose.Schema(
  {
    referralId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Referral',
      required: true,
      unique: true,
      index: true,
    },
    referrerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Section A: Employment Confirmation
    workedTogether: {
      type: String,
      enum: ['Yes', 'No'],
      default: 'Yes',
    },
    companyName: {
      type: String,
      trim: true,
      default: '',
    },
    startDate: {
      type: String,
      trim: true,
      default: null,
    },
    endDate: {
      type: String,
      trim: true,
      default: null,
    },
    isCurrentlyWorking: {
      type: Boolean,
      default: false,
    },

    // Section B: Conduct & Soft Skills Evaluation (Scale: 1 - 10)
    diligence: {
      type: Number,
      min: 1,
      max: 10,
      default: 8,
    },
    enthusiasm: {
      type: Number,
      min: 1,
      max: 10,
      default: 8,
    },
    respectfulness: {
      type: Number,
      min: 1,
      max: 10,
      default: 8,
    },

    // General Summary & Legacy fields
    relationship: {
      type: String,
      trim: true,
      default: 'Colleague',
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: 5,
    },
    feedback: {
      type: String,
      trim: true,
      default: '',
    },
    recommendation: {
      type: String,
      enum: ['Yes', 'No'],
      default: 'Yes',
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('ReferralFeedback', referralFeedbackSchema);
