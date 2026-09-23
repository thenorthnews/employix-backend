const mongoose = require('mongoose');

const certificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    issuer: { type: String, required: true, trim: true },
    year: { type: String, required: true, trim: true },
    credentialId: { type: String, trim: true, default: '' },
    credentialUrl: { type: String, trim: true, default: '' },
    documentUrl: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ['verified', 'pending', 'rejected', 'unverified'],
      default: 'unverified',
    },
    verificationMethod: { type: String, default: 'Manual Upload' },
    badge: { type: String, default: 'Self-Reported / Not Verified' },
  },
  { timestamps: true, versionKey: false }
);

certificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Certification', certificationSchema);
