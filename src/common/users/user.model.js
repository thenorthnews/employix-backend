const mongoose = require('mongoose');
const CONSENT = require('../../config/consent');

const UserSchema = new mongoose.Schema({
	name: { type: String, required: true },
	email: { type: String, required: true, unique: true, lowercase: true },
	password: { type: String, required: true },
	 role: {
      type: String,
      enum: ["user", "employer", "admin"],
      default: "user",
    },
	designation: { type: String, default: '' },
	employixId: { type: String, unique: true, sparse: true },
	phoneNumber: { type: String },
	countryCode: { type: String, default: '+91' },
	profileImage: { type: String },
	image: { type: String },
	address: { type: String, default: '' },
	city: { type: String, default: '' },
	state: { type: String, default: '' },
	pincode: { type: String, default: '' },
	bio: { type: String, default: '' },
	isDeleted: { type: Boolean, default: false },
	isVerified: { type: Boolean, default: false },
  aadhaarStatus: { type: Number, default: 0 },
  panStatus: { type: Number, default: 0 },
  voterStatus: { type: Number, default: 0 },
  dlStatus: { type: Number, default: 0 },
  employmentStatus: { type: Number, default: 0 }, // 0=not done, 1=verified
  kycStatus: { type: Number, default: 0 },
  employixScore: { type: Number, default: 0 },
  rewardPoints: { type: Number, default: 0 },
  otp: {
    type: String,
	default: null,
  },
     dateOfBirth: {
      type: Date,
      default: null,
    },
  otpExpiry: { type: Date },
  resetPasswordToken: {
  type: String,
  default: null
},

resetPasswordExpiry: {
  type: Date,
  default: null
},
 status: {
  type: String,
  enum: [
    CONSENT.STATUS.ACTIVE,
    CONSENT.STATUS.INACTIVE
  ],
  default: CONSENT.STATUS.ACTIVE
}}, { timestamps: true });

UserSchema.pre('save', function (next) {
  if (!this.employixId) {
    const code = this._id ? this._id.toString().slice(-4).toUpperCase() : Math.floor(1000 + Math.random() * 9000);
    this.employixId = `#EMP-${code}-IN`;
  }
  next();
});

module.exports = mongoose.model('User', UserSchema);
