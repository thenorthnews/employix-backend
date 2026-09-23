const mongoose = require('mongoose');

const employmentVerificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    correlationId: { type: String, required: true, index: true },
    setuRequestId: { type: String, trim: true, default: null },
    maskedMobileNumber: { type: String, required: true, trim: true },
    records: [
      {
        _id: false,
        employerName: { type: String, required: true, trim: true },
        memberId: { type: String, trim: true, default: null },
        joiningDate: { type: String, trim: true, default: null },
        exitDate: { type: String, trim: true, default: null },
        name: { type: String, trim: true, default: null },
        guardian: { type: String, trim: true, default: null },
        isCurrent: { type: Boolean, default: false },
      },
    ],

    totalRecordsFound: { type: Number, default: 0 },
    isNameMatched: { type: Boolean, default: false },
    verificationStatus: {
      type: String,
      enum: ['VERIFIED', 'FLAGGED_MISMATCH', 'NOT_FOUND', 'FAILED'],
      default: 'VERIFIED',
      index: true,
    },
    rawGatewayResponse: {
      type: mongoose.Schema.Types.Mixed,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

employmentVerificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('EmploymentVerification', employmentVerificationSchema);