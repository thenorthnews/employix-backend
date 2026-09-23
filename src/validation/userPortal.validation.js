const Joi = require('joi');

// Reusable file structure validator for Multer memory buffers
const multerFileSchema = Joi.object({
  fieldname: Joi.string().required(),
  originalname: Joi.string().required(),
  encoding: Joi.string().required(),
  mimetype: Joi.string()
    .valid('image/jpeg', 'image/png', 'image/jpg', 'application/pdf')
    .required(),
  buffer: Joi.binary().required(),
  size: Joi.number().max(5 * 1024 * 1024).required(), // Max 5MB
}).unknown(true);
const strictConsentSchema = Joi.boolean()
  .truthy('true', '1', 'Y', 'y')
  .falsy('false', '0', 'N', 'n')
  .valid(true)
  .required();

const aadhaarVerificationSchema = Joi.object({
  consent: strictConsentSchema,

  consentPurpose: Joi.string()
    .trim()
    .min(5)
    .max(120)
    .default('Identity verification for onboarding'),

  groupId: Joi.string()
    .trim()
    .max(32)
    .pattern(/^[a-zA-Z0-9_.-]+$/)
    .optional(),

  documentFront: Joi.array()
    .items(multerFileSchema)
    .min(1)
    .max(1)
    .required(),

  documentBack: Joi.array()
    .items(multerFileSchema)
    .max(1)
    .optional(),
}).unknown(false);

const panVerificationSchema = Joi.object({
  pan: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/) // Strict PAN regex
    .required()
    .messages({
      'string.pattern.base': 'Invalid PAN format. Must be 10 characters (e.g. ABCDE1234F)',
    }),

  name: Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(/^[a-zA-Z\s.-]+$/)
    .optional(),

  dob: Joi.string()
    .trim()
    .pattern(/^((0[1-9]|[12][0-9]|3[01])\/(0[1-9]|1[0-2])\/\d{4}|\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]))$/)
    .optional(),

  consent: strictConsentSchema,

  consentPurpose: Joi.string()
    .trim()
    .min(5)
    .max(120)
    .optional(),
}).unknown(false);

const panVerificationOcrSchema = Joi.object({
  panImage: Joi.array()
    .items(multerFileSchema)
    .min(1)
    .max(1)
    .required(),

  consent: strictConsentSchema,

  consentPurpose: Joi.string()
    .trim()
    .min(5)
    .max(120)
    .optional(),
}).unknown(false);

/**
 * 4. Voter ID Verification Schema
 */
const voterIdVerificationSchema = Joi.object({
  number: Joi.string()
    .trim()
    .uppercase()
    .pattern(/^[A-Z]{3}[0-9]{7}$/) // Standard EPIC / Voter ID regex
    .required()
    .messages({
      'string.pattern.base': 'Invalid Voter ID format. Must match standard EPIC format (e.g. ABC1234567)',
    }),


  consentPurpose: Joi.string()
    .trim()
    .min(5)
    .max(120)
    .optional(),
}).unknown(false);
const employmentHistorySchema = Joi.object({
  mobileNumber: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      'string.pattern.base': 'Please provide a valid 10-digit Indian mobile number',
      'any.required': 'Mobile number is required',
    }),

  groupId: Joi.string()
    .trim()
    .max(32)
    .pattern(/^[a-zA-Z0-9_.-]+$/)
    .optional(),

  consent: Joi.boolean()
    .truthy('true', '1')
    .falsy('false', '0')
    .valid(true)
    .required()
    .messages({
      'any.only': 'User consent is required for employment history verification',
    }),
}).unknown(false);

module.exports = {
  aadhaarVerificationSchema,
  panVerificationSchema,
  panVerificationOcrSchema,
  voterIdVerificationSchema,
  employmentHistorySchema

};