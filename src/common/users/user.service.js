const User = require('../users/user.model');
const Identification = require('../../products/user-portal/models/identification.model');
const ManualEmployment = require('../../products/user-portal/models/manualEmployment.model');
const EmploymentVerification = require('../../products/user-portal/models/employmentVerification.model');
const Qualification = require('../../products/user-portal/models/qualification.model');
const Certification = require('../../products/user-portal/models/certification.model');
const Referral = require('../../products/user-portal/models/referral.model');
const ReferralFeedback = require('../../products/user-portal/models/referralFeedback.model');
const RewardTransaction = require('../../products/user-portal/models/rewardTransaction.model');
const DigilockerSession = require('../../products/user-portal/models/digilockerSession.model');
const { uploadImage } = require('../uploadImage/uploadMulture');
const { calculateEmployixScore, calculateEmployeeScore, calculateKycStatus, parseStructuredAddress } = require('../../helpers/documentHelper');

async function getCurrentUserService(userId, req = null) {
  const user = await User.findById(userId).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpiry');
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
      const parsedAadhaarAddr = parseStructuredAddress(aadhaarRecord.address?.fullAddress || aadhaarRecord.address, aadhaarRecord.address);
      aadhaarData = {
        maskedDocumentNumber: aadhaarRecord.maskedDocumentNumber || 'XXXX-XXXX-8921',
        name: aadhaarRecord.name,
        dob: aadhaarRecord.dob,
        gender: aadhaarRecord.gender,
        address: parsedAadhaarAddr,
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
      const parsedVoterAddr = parseStructuredAddress(voterRecord.address?.fullAddress || voterRecord.address, voterRecord.address);
      voterData = {
        maskedDocumentNumber: voterRecord.maskedDocumentNumber || 'WXD1****92',
        name: voterRecord.name,
        dob: voterRecord.dob,
        age: voterRecord.age,
        gender: voterRecord.gender,
        address: parsedVoterAddr,
        verificationMethod: voterRecord.verificationMethod || 'manual_number',
        scoreEarned: 20,
        verifiedAt: voterRecord.verifiedAt,
      };
    }

    if (dlRecord) {
      const parsedDlAddr = parseStructuredAddress(dlRecord.address?.fullAddress || dlRecord.address, dlRecord.address);
      dlData = {
        maskedDocumentNumber: dlRecord.maskedDocumentNumber || 'DL04******2345',
        name: dlRecord.name,
        dob: dlRecord.dob,
        dateOfExpiry: dlRecord.dateOfExpiry,
        vehicleTypes: dlRecord.vehicleTypes,
        validity: dlRecord.validity,
        address: parsedDlAddr,
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

  // Load DigiLocker documents from completed sessions
  let digilockerDocuments = [];
  try {
    const latestDlSession = await DigilockerSession.findOne({ userId, status: 'completed' })
      .sort({ updatedAt: -1 })
      .lean();
    if (latestDlSession && Array.isArray(latestDlSession.documents) && latestDlSession.documents.length > 0) {
      digilockerDocuments = latestDlSession.documents;
    }
  } catch (dlErr) {
    console.error('Error loading DigiLocker documents:', dlErr);
  }

  // Load user references & count verified references (Max 2 allowed)
  let userReferences = [];
  let completedReferencesCount = 0;
  try {
    const rawRefs = await Referral.find({ referrerId: userId }).sort({ createdAt: -1 }).lean();
    completedReferencesCount = rawRefs.filter(
      (ref) => ref.status === 'completed' || ref.isFeedbackSubmitted || ref.isPointsAwarded
    ).length;
    const clientUrl = process.env.CLIENT_APP_URL || 'http://localhost:5173';
    userReferences = await Promise.all(
      rawRefs.map(async (ref) => {
        let feedback = null;
        if (ref.status === 'completed' || ref.isFeedbackSubmitted || ref.isPointsAwarded) {
          feedback = await ReferralFeedback.findOne({ referralId: ref._id }).lean();
        }
        return {
          ...ref,
          shareableLink: ref.rawToken && !ref.isFeedbackSubmitted
            ? `${clientUrl}/reference-verification?token=${ref.rawToken}`
            : null,
          feedback,
        };
      })
    );
  } catch (refErr) {
    console.error('Error loading references:', refErr);
  }

  // Filter DigiLocker documents for genuine educational records only
  const educationalDigiDocs = digilockerDocuments.filter((d) => {
    const norm = (d.docType || '').toLowerCase();
    const name = (d.docName || '').toLowerCase();
    return (
      !['aadhaar', 'pan', 'driving_license', 'voter_id'].includes(norm) &&
      !name.includes('aadhaar') &&
      !name.includes('pan card') &&
      !name.includes('income tax') &&
      !name.includes('voter') &&
      !name.includes('driving license')
    );
  });
  const isDigilockerEduVerified = educationalDigiDocs.length > 0;
  const eduVerified =
    isDigilockerEduVerified ||
    userQualifications.some((q) => q.isVerified === true && q.verificationStatus === 'verified') ||
    userCertifications.some((c) => c.isVerified === true && c.verificationStatus === 'verified');

  const aadhaarDone = user.aadhaarStatus === 1 || Boolean(aadhaarData);
  const voterDone = user.voterStatus === 1 || Boolean(voterData);
  const dlDone = user.dlStatus === 1 || Boolean(dlData);
  const hasEpfo = epfoEmployment.length > 0 || (Array.isArray(rawEpfoDocs) && rawEpfoDocs.length > 0);
  const empVerified = Boolean(hasEpfo);
  const empDoneForKyc = empVerified || manualEmployment.length > 0;
  const hasEduForKyc = userQualifications.length > 0 || userCertifications.length > 0 || isDigilockerEduVerified;

  const scoringData = await calculateEmployeeScore({
    aadhaarDone,
    voterDone,
    eduDone: eduVerified,
    empDone: empVerified,
    verifiedReferencesCount: completedReferencesCount,
  });

  // Calculate score from verified items only
  const currentScore = scoringData.finalPercentage;

  const kycState = user.kycStatus === 8 ? 8 : calculateKycStatus({
    aadhaarDone,
    voterDone,
    dlDone,
    empDone: empDoneForKyc,
    eduDone: hasEduForKyc,
  });

  // Ensure employixId exists on user
  let employixId = user.employixId;
  if (!employixId) {
    const code = user._id ? user._id.toString().slice(-4).toUpperCase() : Math.floor(1000 + Math.random() * 9000);
    employixId = `#EMP-${code}-IN`;
  }

  // Resolve currentAddress: prioritize existing currentAddress, then Aadhaar, Voter, DL, or user profile address
  let currentAddress =
    user.currentAddress?.fullAddress
      ? user.currentAddress
      : (aadhaarData?.address?.fullAddress
          ? aadhaarData.address
          : (voterData?.address?.fullAddress
              ? voterData.address
              : (dlData?.address?.fullAddress
                  ? dlData.address
                  : parseStructuredAddress(user.address))));

  const resolvedAddressString = currentAddress?.fullAddress || user.address || '';

  await User.findByIdAndUpdate(userId, {
    $set: {
      employixId,
      address: resolvedAddressString,
      currentAddress,
      employixScore: currentScore,
      kycStatus: kycState,
      employmentStatus: empVerified ? 1 : 0,
      dlStatus: dlDone ? 1 : 0,
      educationStatus: eduVerified ? 1 : 0,
    },
  });

  const userObj = user.toObject();
  delete userObj.image;
  let resolvedProfileImage = userObj.profileImage || '';
  if (resolvedProfileImage && typeof resolvedProfileImage === 'string' && resolvedProfileImage.startsWith('/uploads/')) {
    const host = req ? `${req.protocol}://${req.get('host')}` : '';
    const baseUrl = (process.env.BASE_URL || host || 'http://13.232.68.44:3000').replace(/\/+$/, '');
    resolvedProfileImage = `${baseUrl}${resolvedProfileImage}`;
  }

  return {
    ...userObj,
    profileImage: resolvedProfileImage,
    employixId,
    address: resolvedAddressString,
    currentAddress,
    employixScore: currentScore,
    kycStatus: kycState,
    employmentStatus: empVerified ? 1 : 0,
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
    digilockerDocuments,
    references: userReferences,
    verifiedReferencesCount: completedReferencesCount,
    profileScoring: scoringData,
  };
}

async function updateProfileService(userId, values, file, req = null) {
  const updateData = {
    ...values,
  };

  const host = req ? `${req.protocol}://${req.get('host')}` : '';
  const baseUrl = (process.env.BASE_URL || host || 'http://13.232.68.44:3000').replace(/\/+$/, '');

  if (file) {
    updateData.profileImage = `${baseUrl}/uploads/profile-images/${file.filename}`;
  } else if (updateData.profileImage || updateData.image) {
    let rawImg = updateData.profileImage || updateData.image;
    if (rawImg && typeof rawImg === 'string' && rawImg.trim()) {
      rawImg = rawImg.trim();
      const finalImg = (rawImg.startsWith('http://') || rawImg.startsWith('https://'))
        ? rawImg
        : `${baseUrl}${rawImg.startsWith('/') ? rawImg : `/${rawImg}`}`;
      updateData.profileImage = finalImg;
    }
  }

  delete updateData.image;

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

  // Handle gender
  if (updateData.gender) {
    updateData.gender = String(updateData.gender).trim();
  }

  // Handle currentAddress and address
  if (updateData.currentAddress !== undefined || updateData.address !== undefined) {
    const addrVal = (updateData.currentAddress !== undefined && updateData.currentAddress !== '')
      ? updateData.currentAddress
      : updateData.address;
    const addrStr = typeof addrVal === 'object' ? (addrVal.fullAddress || addrVal.address || '') : String(addrVal || '').trim();
    updateData.address = addrStr;
    const structured = typeof addrVal === 'object' && addrVal.fullAddress ? addrVal : parseStructuredAddress(addrStr);
    updateData.currentAddress = structured;
    if (structured?.city && !updateData.city) updateData.city = structured.city;
    if (structured?.state && !updateData.state) updateData.state = structured.state;
    if (structured?.pincode && !updateData.pincode) updateData.pincode = structured.pincode;
  }

  if (updateData.gender !== undefined) {
    updateData.gender = typeof updateData.gender === 'string' ? updateData.gender.trim() : updateData.gender;
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
    const fullProfile = await getCurrentUserService(userId, req);
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

  // Purge all associated documents across modules
  await Promise.allSettled([
    Identification.deleteMany({ userId }),
    Qualification.deleteMany({ userId }),
    Certification.deleteMany({ userId }),
    ManualEmployment.deleteMany({ userId }),
    EmploymentVerification.deleteMany({ userId }),
    Referral.deleteMany({ referrerId: userId }),
    ReferralFeedback.deleteMany({ referrerId: userId }),
    RewardTransaction.deleteMany({ userId }),
  ]);

  // Permanently delete user document so email & phone are immediately released for clean re-registration
  await User.findByIdAndDelete(userId);

  return true;
};

module.exports = { getCurrentUserService, updateProfileService, deleteAccountService };
