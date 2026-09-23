const Qualification = require('../../models/qualification.model');
const Certification = require('../../models/certification.model');
const logger = require('../../../../utils/logger');

/**
 * Add a new qualification record
 */
async function addQualificationService({ userId, degree, institution, fieldOfStudy, year, grade, file }) {
  if (!degree || !institution || !year) {
    throw new Error('Degree, Institution, and Passing Year are required');
  }

  let documentUrl = null;
  if (file && file.filename) {
    documentUrl = `/uploads/documents/${file.filename}`;
  }

  const qualification = await Qualification.create({
    userId,
    degree,
    institution,
    fieldOfStudy: fieldOfStudy || '',
    year,
    grade: grade || '',
    documentUrl,
    isVerified: false,
    verificationStatus: 'unverified',
    verificationMethod: 'Manual Upload',
    badge: 'Self-Reported / Not Verified',
  });

  return qualification;
}

/**
 * Get all qualifications for a user
 */
async function getQualificationsService(userId) {
  return await Qualification.find({ userId }).sort({ createdAt: -1 }).lean();
}

/**
 * Delete a qualification
 */
async function deleteQualificationService(userId, qualificationId) {
  const result = await Qualification.findOneAndDelete({ _id: qualificationId, userId });
  if (!result) {
    throw new Error('Qualification not found or unauthorized');
  }
  return true;
}

/**
 * Add a new certification record
 */
async function addCertificationService({ userId, title, issuer, year, credentialId, credentialUrl, file }) {
  if (!title || !issuer || !year) {
    throw new Error('Certification Title, Issuer, and Issue Year are required');
  }

  let documentUrl = null;
  if (file && file.filename) {
    documentUrl = `/uploads/documents/${file.filename}`;
  }

  const certification = await Certification.create({
    userId,
    title,
    issuer,
    year,
    credentialId: credentialId || '',
    credentialUrl: credentialUrl || '',
    documentUrl,
    isVerified: false,
    verificationStatus: 'unverified',
    verificationMethod: 'Manual Upload',
    badge: 'Self-Reported / Not Verified',
  });

  return certification;
}

/**
 * Get all certifications for a user
 */
async function getCertificationsService(userId) {
  return await Certification.find({ userId }).sort({ createdAt: -1 }).lean();
}

/**
 * Delete a certification
 */
async function deleteCertificationService(userId, certificationId) {
  const result = await Certification.findOneAndDelete({ _id: certificationId, userId });
  if (!result) {
    throw new Error('Certification not found or unauthorized');
  }
  return true;
}

module.exports = {
  addQualificationService,
  getQualificationsService,
  deleteQualificationService,
  addCertificationService,
  getCertificationsService,
  deleteCertificationService,
};
