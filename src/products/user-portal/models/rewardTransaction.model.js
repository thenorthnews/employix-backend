const mongoose = require('mongoose');

const rewardTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    referralId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Referral',
      required: true,
      index: true,
    },
    points: {
      type: Number,
      required: true,
      default: 5,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      default: 'credit',
    },
    description: {
      type: String,
      required: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('RewardTransaction', rewardTransactionSchema);
