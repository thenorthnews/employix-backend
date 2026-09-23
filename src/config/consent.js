const CONSENT = {
  REQUIRED: true,
  
  

  OPTIONS: {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
  STATUS: { ACTIVE: 'active', INACTIVE: 'inactive', },
};

module.exports = CONSENT;