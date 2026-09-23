const {
  getCurrentUserService,updateProfileService,deleteAccountService
} = require('./user.service');
const { success, created, badRequest, unauthorized, serverError } = require('../../utils/response');
const { registerSchema, verifyOtpSchema, loginSchema,resendOtpSchema,updateProfileSchema } = require('../../validation/authValidation');


async function getCurrentUser(req, res, next) {
  try {
    const userId = req.user._id || req.user.id;
    const user = await getCurrentUserService(userId)
    return success(res, user, 'Current user profile fetched successfully');
  } catch (err) {
   return serverError(res, err);
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
      req.file
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







module.exports = { getCurrentUser ,updateProfile,deleteAccount};
