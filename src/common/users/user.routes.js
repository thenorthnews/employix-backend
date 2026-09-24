const express = require('express');
const router = express.Router();
const { getCurrentUser,updateProfile,deleteAccount } = require('./user.controller');
const { requireAuth } = require("../../middleware/auth");
const { uploadProfileImage } = require('../uploadImage/uploadMulture');

router.get("/me",requireAuth,getCurrentUser)
router.put( '/updateMe', requireAuth, uploadProfileImage.single('image'), updateProfile );
router.delete("/deleteAccount", requireAuth, deleteAccount);

module.exports = router;
