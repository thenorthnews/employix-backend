const User = require('../users/user.model');
const Identification = require('../../products/user-portal/models/identification.model');
const ManualEmployment = require('../../products/user-portal/models/manualEmployment.model');
const EmploymentVerification = require('../../products/user-portal/models/employmentVerification.model');
const Qualification = require('../../products/user-portal/models/qualification.model');
const Certification = require('../../products/user-portal/models/certification.model');
const { uploadImage } = require('../uploads/uploadMulture');
const { calculateEmployixScore, calculateKycStatus } = require('../../helpers/documentHelper');

async function getCurrentUserService(userId) {
  const user = await User.findById(userId).select('-password -otp -otpExpiry');
  if (!user) {
    throw new Error('User not found');
  }

  let aadhaarData = null;
  let panData = null;
  let voterData = null;
  let dlData = null;

  try {
    const records = await Identification.find({
      userId,
      documentType: { $in: ['aadhaar', 'pan', 'voter_id', 'driving_license'] },
      verificationStatus: 'verified',
    }).lean();

    const aadhaarRecord = records.find((r) => r.documentType === 'aadhaar');
    const panRecord = records.find((r) => r.documentType === 'pan');
    const voterRecord = records.find((r) => r.documentType === 'voter_id');
    const dlRecord = records.find((r) => r.documentType === 'driving_license');

    if (aadhaarRecord) {
      aadhaarData = {
        maskedDocumentNumber: aadhaarRecord.maskedDocumentNumber || 'XXXX-XXXX-8921',
        verificationMethod: aadhaarRecord.verificationMethod || 'ocr_scan',
        scoreEarned: aadhaarRecord.scoreEarned || 20,
        verifiedAt: aadhaarRecord.verifiedAt,
      };
    }

    if (panRecord) {
      panData = {
        maskedDocumentNumber: panRecord.maskedDocumentNumber || 'ABCDE****F',
        panStatus: panRecord.panStatus || 'VALID & ACTIVE',
        verificationMethod: panRecord.verificationMethod || 'manual_number',
        scoreEarned: panRecord.scoreEarned || 20,
        isAadhaarPanLinked: panRecord.isAadhaarPanLinked,
        verifiedAt: panRecord.verifiedAt,
      };
    }

    if (voterRecord) {
      voterData = {
        maskedDocumentNumber: voterRecord.maskedDocumentNumber || 'WXD1****92',
        name: voterRecord.name,
        address: voterRecord.address,
        verificationMethod: voterRecord.verificationMethod || 'manual_number',
        scoreEarned: 20,
        verifiedAt: voterRecord.verifiedAt,
      };
    }

    if (dlRecord) {
      dlData = {
        maskedDocumentNumber: dlRecord.maskedDocumentNumber || 'DL04******2345',
        name: dlRecord.name,
        dob: dlRecord.dob,
        dateOfExpiry: dlRecord.dateOfExpiry,
        vehicleTypes: dlRecord.vehicleTypes,
        validity: dlRecord.validity,
        address: dlRecord.address,
        verificationMethod: dlRecord.provider || 'setu_dl_ocr',
        scoreEarned: 5,
        verifiedAt: dlRecord.verifiedAt,
      };
    }
  } catch (err) {
    console.error('Error loading identifications:', err);
  }

  // Load manual & epfo employments
  let manualEmployment = [];
  let epfoEmployment = [];
  let rawEpfoDocs = [];
  try {
    manualEmployment = await ManualEmployment.find({ userId }).sort({ createdAt: -1 }).lean();
    rawEpfoDocs = await EmploymentVerification.find({ userId }).sort({ createdAt: -1 }).lean();
    epfoEmployment = rawEpfoDocs
      .flatMap((doc) => (Array.isArray(doc.records) ? doc.records : (doc.employerName ? [doc] : [])))
      .filter(Boolean);
  } catch (err) {
    console.error('Error loading employments:', err);
  }

  // Load separate table qualifications & certifications
  let userQualifications = [];
  let userCertifications = [];
  try {
    userQualifications = await Qualification.find({ userId }).sort({ createdAt: -1 }).lean();
    userCertifications = await Certification.find({ userId }).sort({ createdAt: -1 }).lean();
  } catch (err) {
    console.error('Error loading qualifications/certifications:', err);
  }

  // Calculate dynamic 7-step Trust Score & KYC State (100 Points Total)
  // Aadhaar: 20 pts, Voter: 20 pts, Qualifications/Certs: 20 pts (only if verified), Employment: 35 pts, Driving License: 5 pts
  const aadhaarDone = user.aadhaarStatus === 1 || Boolean(aadhaarData);
  const voterDone = user.voterStatus === 1 || Boolean(voterData);
  const dlDone = user.dlStatus === 1 || Boolean(dlData);
  const empDone = user.employmentStatus === 1 || manualEmployment.length > 0 || epfoEmployment.length > 0;
  const hasEdu = userQualifications.length > 0 || userCertifications.length > 0;
  const eduVerified =
    userQualifications.some((q) => q.isVerified === true && q.verificationStatus === 'verified') ||
    userCertifications.some((c) => c.isVerified === true && c.verificationStatus === 'verified');

  const currentScore = calculateEmployixScore({
    aadhaarDone,
    voterDone,
    dlDone,
    empDone,
    eduDone: eduVerified,
  });

  const kycState = user.kycStatus === 8 ? 8 : calculateKycStatus({
    aadhaarDone,
    voterDone,
    dlDone,
    empDone,
    eduDone: hasEdu,
  });

  // Ensure employixId exists on user
  let employixId = user.employixId;
  if (!employixId) {
    const code = user._id ? user._id.toString().slice(-4).toUpperCase() : Math.floor(1000 + Math.random() * 9000);
    employixId = `#EMP-${code}-IN`;
  }

  // Sync address & status if voterRecord has address and user has none
  const resolvedAddress = user.address || voterData?.address || '';
  if (
    !user.employixId ||
    (!user.address && voterData?.address) ||
    user.employixScore !== currentScore ||
    user.kycStatus !== kycState ||
    user.dlStatus !== (dlDone ? 1 : 0)
  ) {
    await User.findByIdAndUpdate(userId, {
      $set: {
        employixId,
        address: resolvedAddress,
        employixScore: currentScore,
        kycStatus: kycState,
        employmentStatus: empDone ? 1 : 0,
        dlStatus: dlDone ? 1 : 0,
      },
    });
  }

  const userObj = user.toObject();
  return {
    ...userObj,
    employixId,
    address: resolvedAddress,
    employixScore: currentScore,
    kycStatus: kycState,
    employmentStatus: empDone ? 1 : 0,
    dlStatus: dlDone ? 1 : 0,
    educationStatus: eduVerified ? 1 : 0,
    aadhaarData,
    panData,
    voterData,
    dlData,
    manualEmployment,
    epfoEmployment,
    rawEpfoRecords: rawEpfoDocs,
    qualifications: userQualifications,
    certifications: userCertifications,
  };
}

async function updateProfileService(userId, values, file) {
  const updateData = {
    ...values,
  };

  if (file) {
    updateData.image = `/uploads/profile-images/${file.filename}`;
    updateData.profileImage = updateData.image;
  } else if (updateData.image && !updateData.profileImage) {
    updateData.profileImage = updateData.image;
  }

  // Remove fields that should not be overwritten
  delete updateData.profession;
  delete updateData.password;
  delete updateData._id;
  delete updateData.id;

  // Do not overwrite unique email with null/empty
  if (!updateData.email) {
    delete updateData.email;
  }

  // Map phone to phoneNumber if provided
  if (updateData.phone && !updateData.phoneNumber) {
    updateData.phoneNumber = updateData.phone;
  }

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: false,
    }
  ).select('-password -otp -otpExpiry');

  if (!user) {
    throw new Error('User not found');
  }

  try {
    const fullProfile = await getCurrentUserService(userId);
    return fullProfile;
  } catch (err) {
    return user;
  }
}
const deleteAccountService = async (userId) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new Error("User not found");
  }

  await User.findByIdAndUpdate(userId, {
    isDeleted: true
  });

  return true;
};

module.exports = { getCurrentUserService, updateProfileService, deleteAccountService };
