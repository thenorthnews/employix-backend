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

async function getPublicVerifiedProfileService(identifier, req = null) {
  if (!identifier || typeof identifier !== 'string') {
    throw new Error('Valid candidate identifier is required');
  }

  const cleanId = identifier.trim();
  const rawIdNoHash = cleanId.replace(/^#/, '');

  let user = null;

  // 1. Try finding by employixId
  user = await User.findOne({
    $or: [
      { employixId: cleanId },
      { employixId: `#${rawIdNoHash}` },
      { employixId: rawIdNoHash },
      { employixId: { $regex: new RegExp(`^#?${rawIdNoHash}$`, 'i') } }
    ],
    isDeleted: { $ne: true }
  }).select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpiry');

  // 2. If not found and valid ObjectId, find by _id
  if (!user && cleanId.match(/^[0-9a-fA-F]{24}$/)) {
    user = await User.findOne({ _id: cleanId, isDeleted: { $ne: true } })
      .select('-password -otp -otpExpiry -resetPasswordToken -resetPasswordExpiry');
  }

  if (!user) {
    throw new Error('Candidate verified profile not found');
  }

  const fullData = await getCurrentUserService(user._id, req);

  // Mask sensitive candidate contacts for public employer view
  const maskEmail = (email) => {
    if (!email || typeof email !== 'string') return '';
    const parts = email.split('@');
    if (parts.length !== 2) return email;
    const name = parts[0];
    const domain = parts[1];
    const visibleStart = name.slice(0, 1);
    const visibleEnd = name.length > 2 ? name.slice(-1) : '';
    return `${visibleStart}****${visibleEnd}@${domain}`;
  };

  const maskPhone = (phone) => {
    if (!phone || typeof phone !== 'string') return '';
    const clean = phone.replace(/\D/g, '');
    if (clean.length < 4) return '******';
    return `+91 ******${clean.slice(-4)}`;
  };

  return {
    _id: fullData._id,
    employixId: fullData.employixId,
    name: fullData.name,
    designation: fullData.designation || 'Professional',
    profileImage: fullData.profileImage,
    gender: fullData.gender,
    city: fullData.city || fullData.currentAddress?.city || 'India',
    state: fullData.state || fullData.currentAddress?.state || '',
    maskedEmail: maskEmail(fullData.email),
    maskedPhone: maskPhone(fullData.phoneNumber || fullData.phone),
    isAadhaarVerified: Boolean(fullData.aadhaarStatus === 1 || fullData.aadhaarData),
    isVoterVerified: Boolean(fullData.voterStatus === 1 || fullData.voterData),
    isDlVerified: Boolean(fullData.dlStatus === 1 || fullData.dlData),
    isPanVerified: Boolean(fullData.panStatus === 1 || fullData.panData),
    isEmploymentVerified: Boolean(fullData.employmentStatus === 1 || fullData.epfoEmployment?.length > 0),
    isEducationVerified: Boolean(fullData.educationStatus === 1 || fullData.qualifications?.length > 0 || fullData.certifications?.length > 0),
    employixScore: fullData.employixScore || 0,
    profileScoring: fullData.profileScoring || null,
    kycStatus: fullData.kycStatus,
    qualifications: (fullData.qualifications || []).map(q => {
      const isDigi = Boolean(
        q.isDigilocker || 
        q.verificationMethod === 'DigiLocker' || 
        q.badge === 'DigiLocker Verified' ||
        (fullData.digilockerDocuments && fullData.digilockerDocuments.some(d => d.documentName === q.degree || d.title === q.degree))
      );
      return {
        _id: q._id,
        degree: q.degree || q.qualification,
        institution: q.institution || q.college || q.university,
        fieldOfStudy: q.fieldOfStudy || q.branch,
        graduationYear: q.graduationYear || q.yearOfPassing || q.year,
        isVerified: Boolean(q.isVerified || q.verificationStatus === 'verified' || isDigi),
        verificationStatus: q.verificationStatus || (isDigi ? 'verified' : 'unverified'),
        verificationMethod: isDigi ? 'DigiLocker Verified' : 'Manual Document Verified',
        isDigilocker: isDigi
      };
    }),
    certifications: (fullData.certifications || []).map(c => {
      const isDigi = Boolean(
        c.isDigilocker || 
        c.verificationMethod === 'DigiLocker' || 
        c.badge === 'DigiLocker Verified'
      );
      return {
        _id: c._id,
        name: c.name || c.title || c.certificateName,
        issuingOrganization: c.issuingOrganization || c.issuer,
        issueDate: c.issueDate || c.year,
        isVerified: Boolean(c.isVerified || c.verificationStatus === 'verified' || isDigi),
        verificationMethod: isDigi ? 'DigiLocker Verified' : 'Manual Document Verified',
        isDigilocker: isDigi
      };
    }),
    employmentHistory: [
      ...(fullData.epfoEmployment || []).map(e => ({
        employerName: e.employerName || e.establishmentName || e.companyName,
        designation: e.designation || e.role || fullData.designation,
        memberId: e.memberId ? `${e.memberId.slice(0, 4)}****` : null,
        doj: e.doj || e.joiningDate || e.startDate,
        doe: e.doe || e.exitDate || e.endDate || 'Present',
        isVerified: true,
        verificationMethod: 'EPFO Verified',
        type: 'EPFO Verified'
      })),
      ...(fullData.manualEmployment || []).map(m => ({
        employerName: m.companyName || m.employerName,
        designation: m.designation || m.role,
        doj: m.startDate || m.joiningDate,
        doe: m.isCurrent ? 'Present' : (m.endDate || 'Relieved'),
        isVerified: Boolean(m.isVerified),
        verificationMethod: 'Manual Document Verified',
        type: 'Manual Document Verified'
      }))
    ],
    referencesCount: fullData.verifiedReferencesCount || (fullData.references || []).length,
    referencesSummary: (fullData.references || []).filter(r => r.status === 'completed' || r.isFeedbackSubmitted).map(r => ({
      relationship: r.relationship,
      company: r.companyName || r.company,
      overallRating: r.feedback?.ratings?.overallPerformance || r.feedback?.overallRating || 5,
      workEthicRating: r.feedback?.ratings?.workEthic || 5,
      teamworkRating: r.feedback?.ratings?.teamwork || 5,
      technicalRating: r.feedback?.ratings?.technicalSkills || 5,
      recommendation: r.feedback?.recommendation || 'Highly Recommended',
      verifiedAt: r.feedback?.createdAt || r.updatedAt
    })),
    verifiedAt: fullData.updatedAt || new Date(),
  };
}

module.exports = { getCurrentUserService, updateProfileService, deleteAccountService, getPublicVerifiedProfileService };
