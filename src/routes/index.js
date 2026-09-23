

const express = require('express');
const router = express.Router();
const authRoutes = require('../common/auth/auth.routes');
const userRoutes = require('../common/users/user.routes');
const userPortalRoutes = require("../products/user-portal/userPortal.routes")


// Mount routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/user-portal', userPortalRoutes); // Mount at /user-portal
module.exports = router;
