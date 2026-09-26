const Joi  = require("joi")
 const registerSchema = Joi.object({
    name: Joi.string().min(2).max(50).trim().required(),
    email: Joi.string().email().trim().lowercase().required(),
    phone: Joi.string().pattern(/^[0-9]{10,15}$/).required(),
    profileImage: Joi.string().uri().optional().allow('', null),
    password: Joi.string().min(6).optional().default('Employix@123'),
    role: Joi.string().valid('user', 'admin').default('user')
});
 const verifyOtpSchema = Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    otp: Joi.string().length(6).required()
});
const resendOtpSchema = Joi.object({
  email: Joi.string()
    .email({ minDomainSegments: 2 })
    .trim()
    .lowercase()
    .required()
    .messages({
      'string.base': 'Email must be a string',
      'string.empty': 'Email is required to resend OTP',
      'string.email': 'Please enter a valid email address',
      'any.required': 'Email is required to resend OTP',
    }),
});
const loginSchema = Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    // password: Joi.string().min(6).required()
});

const updateProfileSchema = Joi.object({
  prefix: Joi.string().trim().allow('', null),
  name: Joi.string().trim().min(2).max(100),
  email: Joi.string().trim().email().allow('', null),
  designation: Joi.string().trim().allow('', null),
  phoneNumber: Joi.string().trim().allow('', null),
  countryCode: Joi.string().trim().allow('', null),
  address: Joi.string().trim().allow('', null),
  city: Joi.string().trim().allow('', null),
  state: Joi.string().trim().allow('', null),
  pincode: Joi.string().trim().allow('', null),
  profileImage: Joi.string().allow('', null),
}).unknown(true);



module.exports = {registerSchema, verifyOtpSchema, resendOtpSchema,loginSchema,updateProfileSchema}