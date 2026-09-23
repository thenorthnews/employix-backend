const mongoose = require('mongoose');

const manualEmploymentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyName: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    startDate: { type: String, required: true, trim: true },
    endDate: { type: String, trim: true, default: null },
    isCurrent: { type: Boolean, default: false },
    description: { type: String, trim: true, default: '' },
    epfoAuthenticated: { type: Boolean, default: false },
    employerHrmsSync: { type: Boolean, default: false },
    relievingLetterAudit: { type: Boolean, default: false },
  },
  { timestamps: true, versionKey: false }
);

manualEmploymentSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ManualEmployment', manualEmploymentSchema);
