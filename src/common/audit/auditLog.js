const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    correlationId: {
      type: String,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true, 
      index: true,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILURE'],
      required: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    ipAddress: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
      default: null,
    },
    details: {
      type: mongoose.Schema.Types.Mixed, 
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, 
  }
);
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AuditLog', auditLogSchema);