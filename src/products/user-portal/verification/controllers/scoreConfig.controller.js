const ScoreConfig = require('../../models/scoreConfig.model');
const { success, badRequest, serverError } = require('../../../../utils/response');
const logger = require('../../../../utils/logger');

/**
 * Get active dynamic scoring configuration from DB table
 * GET /v1/user-portal/score-config
 */
const getScoreConfiguration = async (req, res) => {
  try {
    const config = await ScoreConfig.getActiveConfig(true);
    return success(
      res,
      {
        config,
        breakdown: {
          aadhaar: config.aadhaarScore,
          voter: config.voterScore,
          education: config.educationScore,
          employment: config.employmentScore,
          reference: {
            scorePerReference: config.referenceScorePerItem,
            maxReferencesAllowed: config.maxReferencesAllowed,
            maxReferenceScore: config.referenceScorePerItem * config.maxReferencesAllowed,
          },
          totalApplicableScore: config.totalApplicableScore,
        },
      },
      'Score configuration fetched successfully from database table'
    );
  } catch (error) {
    logger.error('Failed to get score configuration', { error: error.message });
    return serverError(res, error.message);
  }
};

/**
 * Update dynamic scoring configuration in DB table
 * PUT /v1/user-portal/score-config
 */
const updateScoreConfiguration = async (req, res) => {
  try {
    const {
      aadhaarScore,
      voterScore,
      educationScore,
      employmentScore,
      referenceScorePerItem,
      maxReferencesAllowed,
      totalApplicableScore,
      description,
    } = req.body;

    const updatedConfig = await ScoreConfig.updateActiveConfig({
      aadhaarScore,
      voterScore,
      educationScore,
      employmentScore,
      referenceScorePerItem,
      maxReferencesAllowed,
      totalApplicableScore,
      description,
    });

    return success(
      res,
      {
        config: updatedConfig,
        breakdown: {
          aadhaar: updatedConfig.aadhaarScore,
          voter: updatedConfig.voterScore,
          education: updatedConfig.educationScore,
          employment: updatedConfig.employmentScore,
          reference: {
            scorePerReference: updatedConfig.referenceScorePerItem,
            maxReferencesAllowed: updatedConfig.maxReferencesAllowed,
            maxReferenceScore: updatedConfig.referenceScorePerItem * updatedConfig.maxReferencesAllowed,
          },
          totalApplicableScore: updatedConfig.totalApplicableScore,
        },
      },
      'Score configuration table updated successfully'
    );
  } catch (error) {
    logger.error('Failed to update score configuration', { error: error.message });
    return badRequest(res, error.message);
  }
};

module.exports = {
  getScoreConfiguration,
  updateScoreConfiguration,
};
