const {
  getCurrentUserService, updateProfileService, deleteAccountService, getPublicVerifiedProfileService
} = require('./user.service');
const { success, created, badRequest, unauthorized, serverError } = require('../../utils/response');
const { registerSchema, verifyOtpSchema, loginSchema, resendOtpSchema, updateProfileSchema } = require('../../validation/authValidation');

async function getCurrentUser(req, res, next) {
  try {
    const userId = req.user._id || req.user.id;
    const user = await getCurrentUserService(userId, req);
    return success(res, user, 'Current user profile fetched successfully');
  } catch (err) {
   return serverError(res, err);
  }
}

async function getPublicVerifiedProfile(req, res, next) {
  try {
    const { identifier } = req.params;
    const profile = await getPublicVerifiedProfileService(identifier, req);
    return success(res, profile, 'Candidate verified profile fetched successfully');
  } catch (err) {
    return badRequest(res, err.message || 'Candidate verified profile not found');
  }
}
async function updateProfile(req, res, next) {
  try {
    const { error, value } = updateProfileSchema.validate(
      req.body,
      {
        abortEarly: false,
      }
    );
if (error) {
      const errorMessage = error.details.map((d) => d.message).join(', ');
      return badRequest(res, errorMessage);
    }
    const userId = req.user._id || req.user.id;
    const updatedUser = await updateProfileService(
      userId,
      value,
      req.file,
      req
    );

    return success(
      res,
      updatedUser,
      'Profile updated successfully'
    );

  } catch (err) {
 return serverError(res, err);
  }
}
async function deleteAccount(req, res, next)
{
  try {
    const userId = req.user._id || req.user.id;
    const deletedUser = await deleteAccountService(userId);
    return success(res, deletedUser, 'Account deleted successfully');
  } catch (err) {
 return serverError(res, err);

  }
  }







module.exports = { getCurrentUser, getPublicVerifiedProfile, updateProfile, deleteAccount };
