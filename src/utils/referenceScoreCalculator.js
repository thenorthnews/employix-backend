/**
 * Reference Trust Score and Progress Calculator
 *
 * System Rules:
 * - Candidate can add up to 2 references.
 * - Each completed reference awards up to 5 points (Total Maximum Target = 10 points).
 *
 * @param {Array<Object>} references - Array of reference objects
 *   e.g. [{ status: 'COMPLETED', points: 5 }, { status: 'PENDING', points: 0 }]
 *   or [{ status: 'completed', isFeedbackSubmitted: true }, ...]
 * @returns {Object} Score summary:
 *   - totalEarnedPoints: Total points accumulated from completed references
 *   - maxPossibleTarget: 10
 *   - completedReferencesCount: Number of verified/completed references
 *   - trustScorePercentage: Percentage based on completed references (0 to 100)
 *   - overallProgressPercentage: Overall progress toward target of 10 points (0 to 100)
 */
function calculateReferenceScores(references = []) {
  const MAX_POSSIBLE_TARGET = 10;
  const POINTS_PER_REFERENCE = 5;

  if (!Array.isArray(references) || references.length === 0) {
    return {
      totalEarnedPoints: 0,
      maxPossibleTarget: MAX_POSSIBLE_TARGET,
      completedReferencesCount: 0,
      trustScorePercentage: 0,
      overallProgressPercentage: 0,
    };
  }

  // Filter completed references
  const completedRefs = references.filter((ref) => {
    if (!ref) return false;
    const statusUpper = String(ref.status || '').toUpperCase();
    return (
      statusUpper === 'COMPLETED' ||
      ref.isFeedbackSubmitted === true ||
      ref.isPointsAwarded === true
    );
  });

  const completedReferencesCount = completedRefs.length;

  // Calculate earned points: use explicit points if provided, otherwise 5 per completed reference
  const totalEarnedPoints = completedRefs.reduce((acc, ref) => {
    const pts = typeof ref.points === 'number' ? ref.points : (ref.isPointsAwarded || ref.isFeedbackSubmitted ? POINTS_PER_REFERENCE : 0);
    return acc + pts;
  }, 0);

  // Trust score: (totalEarnedPoints / (completedReferencesCount * 5)) * 100
  // Safe from zero division: if completedReferencesCount === 0, returns 0%
  const trustScorePercentage =
    completedReferencesCount > 0
      ? Math.min(100, Math.round((totalEarnedPoints / (completedReferencesCount * POINTS_PER_REFERENCE)) * 100))
      : 0;

  // Overall progress percentage: (totalEarnedPoints / 10) * 100
  const overallProgressPercentage = Math.min(
    100,
    Math.round((totalEarnedPoints / MAX_POSSIBLE_TARGET) * 100)
  );

  return {
    totalEarnedPoints,
    maxPossibleTarget: MAX_POSSIBLE_TARGET,
    completedReferencesCount,
    trustScorePercentage,
    overallProgressPercentage,
  };
}

module.exports = {
  calculateReferenceScores,
};
