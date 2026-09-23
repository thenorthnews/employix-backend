const mongoose = require('mongoose');

const identificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ['aadhaar', 'pan', 'voter_id', 'driving_license'],
      required: true,
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'processing', 'verified', 'failed'],
      default: 'pending',
    },
    provider: {
      type: String,
      default: 'setu',
    },
    groupId: {
      type: String,
      default: null,
      index: true,
    },
    correlationId: {
      type: String,
      default: null,
    },
    // Standardized to maskedDocumentNumber (e.g. DL01******6789)
    maskedDocumentNumber: {
      type: String,
      default: null,
    },
    name: {
      type: String,
      default: null,
      trim: true,
    },
    dob: {
      type: Date,
      default: null,
    },
    age: {
      type: Number,
      default: null,
    },
    gender: {
      type: String,
      default: null,
    },
    address: {
      fullAddress: { type: String, default: null },
      streetAddress: { type: String, default: null },
      city: { type: String, default: null },
      district: { type: String, default: null },
      state: { type: String, default: null },
      pincode: { type: String, default: null },
    },
    score: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    fatherOrHusbandName: {
      type: String,
      trim: true,
      default: null,
    },
    dateOfExpiry: {
      type: Date,
      default: null,
    },
    vehicleTypes: {
      type: [String], 
      default: [],
    },
    validity: {
      nonTransport: { type: Date, default: null },
      transport: { type: Date, default: null },
    },
    isScanned: {
      type: Boolean,
      default: false,
    },
    verificationMethod: {
      type: String,
      enum: ['manual_number', 'ocr_scan'],
      default: 'manual_number',
    },
    scoreEarned: {
      type: Number,
      default: 20,
    },
    // Setu Aadhaar Masking Fields
    isMasked: {
      type: Boolean,
      default: false,
    },
    maskedDocURL: {
      type: String,
      default: null,
    },
    originalDocURL: {
      type: String,
      default: null,
    },

    // Versioned Consent & Audit Engine Fields
    consentGiven: {
      type: Boolean,
      required: true,
      default: false,
    },
    consentVersion: {
      type: String,
      default: 'v1.0',
    },
    consentTimestamp: {
      type: Date,
      default: null,
    },
    consentPurpose: {
      type: String,
      default: 'Identity verification for onboarding',
    },
    consentIp: {
      type: String,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    verifiedAt: {
      type: Date,
      default: null,
    },

    // PAN Specific Fields
    isAadhaarPanLinked: {
      type: String,
      default: '',
    },
    panStatus: {
      type: String,
      default: '',
    },
    panType: {
      type: String,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for fast upsert & idempotency
identificationSchema.index({ userId: 1, documentType: 1 }, { unique: true });

module.exports = mongoose.model('Identification', identificationSchema);