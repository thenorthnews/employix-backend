const mongoose = require('mongoose');

const qualificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    degree: { type: String, required: true, trim: true },
    institution: { type: String, required: true, trim: true },
    fieldOfStudy: { type: String, trim: true, default: '' },
    year: { type: String, required: true, trim: true },
    grade: { type: String, trim: true, default: '' },
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

qualificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Qualification', qualificationSchema);
