const mongoose = require('mongoose');

const digilockerSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    clientId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    initialUrl: {
      type: String,
      required: true,
      trim: true,
    },
    redirectUrl: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: ['initialized', 'processing', 'completed', 'failed'],
      default: 'initialized',
      index: true,
    },
    config: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    verifiedProfile: {
      name: { type: String, default: null },
      dob: { type: String, default: null },
      gender: { type: String, default: null },
      phone: { type: String, default: null },
      email: { type: String, default: null },
      address: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    documents: [
      {
        docType: { type: String, required: true },
        docName: { type: String, default: null },
        docNumber: { type: String, default: null },
        maskedDocNumber: { type: String, default: null },
        downloadUrl: { type: String, default: null },
        issueDate: { type: String, default: null },
        issuer: { type: String, default: null },
        rawMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    ],
    rawInitializeResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    rawDocumentsResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    errorMessage: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

digilockerSessionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('DigilockerSession', digilockerSessionSchema);
