const express = require('express');
const router = express.Router();
const { getCurrentUser,updateProfile,deleteAccount } = require('./user.controller');
const { requireAuth } = require("../../middleware/auth");
const { uploadProfileImage } = require('../uploadImage/uploadMulture');

router.get("/me",requireAuth,getCurrentUser)
router.put(
  '/updateMe',
  requireAuth,
  (req, res, next) => {
    uploadProfileImage.fields([
      { name: 'profileImage', maxCount: 1 },
      { name: 'image', maxCount: 1 },
    ])(req, res, (err) => {
      if (err) {
        return res.status(400).json({ success: false, message: err.message || 'Image upload failed' });
      }
      if (req.files) {
        req.file = req.files.profileImage?.[0] || req.files.image?.[0] || null;
      }
      next();
    });
  },
  updateProfile
);
router.delete("/deleteAccount", requireAuth, deleteAccount);

module.exports = router;
