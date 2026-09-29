const mongoose = require('mongoose');

const DEFAULT_SCORE_CONFIG = {
  configName: 'default',
  aadhaarScore: 20,
  voterScore: 20,
  educationScore: 20,
  employmentScore: 30,
  referenceScorePerItem: 5,
  maxReferencesAllowed: 2,
  totalApplicableScore: 100,
  isActive: true,
  description: 'Default scoring matrix: Aadhaar 20, Voter 20, Education 20, Employment 30, Reference 5 to 5 (max 10, 2 references)',
};

let cachedScoreConfig = { ...DEFAULT_SCORE_CONFIG };
let lastCacheTime = 0;
const CACHE_TTL_MS = 15000; // 15 seconds cache to balance performance and dynamic responsiveness

const scoreConfigSchema = new mongoose.Schema(
  {
    configName: {
      type: String,
      default: 'default',
      unique: true,
      trim: true,
    },
    // Aadhaar Card Score (20)
    aadhaarScore: {
      type: Number,
      default: 20,
      min: 0,
      max: 100,
    },
    // Voter ID Card Score (20)
    voterScore: {
      type: Number,
      default: 20,
      min: 0,
      max: 100,
    },
    // Education / Qualifications Score (20)
    educationScore: {
      type: Number,
      default: 20,
      min: 0,
      max: 100,
    },
    // Employment Verification Score (30)
    employmentScore: {
      type: Number,
      default: 30,
      min: 0,
      max: 100,
    },
    // Employee Reference Score per item (5 to 5)
    referenceScorePerItem: {
      type: Number,
      default: 5,
      min: 0,
      max: 100,
    },
    // Maximum verified references allowed to earn points (Default: 2)
    maxReferencesAllowed: {
      type: Number,
      default: 2,
      min: 1,
      max: 10,
    },
    // Total applicable target score (Default: 100)
    totalApplicableScore: {
      type: Number,
      default: 100,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    description: {
      type: String,
      default: 'Employix dynamic scoring configuration table',
    },
  },
  {
    timestamps: true,
    collection: 'score_configs',
  }
);

/**
 * Fetch the active score configuration from database.
 * If not present, auto-seeds default scoring config into DB.
 */
scoreConfigSchema.statics.getActiveConfig = async function (forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedScoreConfig && now - lastCacheTime < CACHE_TTL_MS) {
    return { ...cachedScoreConfig };
  }

  try {
    let config = await this.findOne({ isActive: true });
    if (!config) {
      // Auto-seed default configuration in DB table
      const created = await this.create(DEFAULT_SCORE_CONFIG);
      config = created.toObject ? created.toObject() : created;
    } else if (config.voterScore !== 20 || config.employmentScore !== 30) {
      // Sync DB config to standard matrix: Voter 20, Employment 30
      config.voterScore = 20;
      config.employmentScore = 30;
      await config.save();
    }

    const configObj = config.toObject ? config.toObject() : config;
    cachedScoreConfig = {
      ...DEFAULT_SCORE_CONFIG,
      ...configObj,
    };
    lastCacheTime = now;
    return { ...cachedScoreConfig };
  } catch (error) {
    console.error('Error fetching score config from database, using cached fallback:', error.message);
    return { ...cachedScoreConfig };
  }
};

/**
 * Synchronous getter returning latest cached configuration
 */
scoreConfigSchema.statics.getCachedConfig = function () {
  return { ...cachedScoreConfig };
};

/**
 * Update active score configuration in table and refresh in-memory cache
 */
scoreConfigSchema.statics.updateActiveConfig = async function (updates = {}) {
  const allowedKeys = [
    'aadhaarScore',
    'voterScore',
    'educationScore',
    'employmentScore',
    'referenceScorePerItem',
    'maxReferencesAllowed',
    'totalApplicableScore',
    'description',
  ];

  const updatePayload = {};
  for (const key of allowedKeys) {
    if (updates[key] !== undefined && updates[key] !== null) {
      updatePayload[key] = Number(updates[key]);
      if (isNaN(updatePayload[key])) {
        delete updatePayload[key];
      }
    }
  }

  if (updates.description) {
    updatePayload.description = String(updates.description);
  }

  let updatedDoc = await this.findOneAndUpdate(
    { isActive: true },
    { $set: updatePayload },
    { new: true, upsert: true, runValidators: true }
  ).lean();

  cachedScoreConfig = {
    ...DEFAULT_SCORE_CONFIG,
    ...updatedDoc,
  };
  lastCacheTime = Date.now();
  return { ...cachedScoreConfig };
};

const ScoreConfig = mongoose.model('ScoreConfig', scoreConfigSchema);

module.exports = ScoreConfig;
