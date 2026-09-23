const express = require('express');
const router = express.Router();
const { register, login,verify,resendOtp,logout,getCurrentUser,forgotPassword,resetPassword,showResetPasswordPage } = require('./auth.controller');
const { requireAuth } = require("../../middleware/auth");
router.post('/register', register);
router.post('/verifyOtp', verify);
router.post('/login', login);
router.post("/resendOtp",resendOtp)
router.post("/logout",requireAuth,logout)
router.post("/forgot-password", forgotPassword);
router.get("/reset-password/:token", showResetPasswordPage);
router.post("/reset-password", resetPassword);

// router.post('/register', (req, res, next) => {
//   console.log("🔥🔥🔥 ROUTE HIT HUA, BODY HAI:", req.body);
//   return register(req, res, next);
// });

module.exports = router;
