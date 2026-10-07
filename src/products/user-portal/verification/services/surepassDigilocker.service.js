const axios = require('axios');
const logger = require('../../../../utils/logger');
const User = require('../../../../common/users/user.model');
const Identification = require('../../models/identification.model');
const Qualification = require('../../models/qualification.model');
const Certification = require('../../models/certification.model');
const DigilockerSession = require('../../models/digilockerSession.model');
const EmploymentVerification = require('../../models/employmentVerification.model');
const Referral = require('../../models/referral.model');
const ScoreConfig = require('../../models/scoreConfig.model');
const {
  maskDocumentNumber,
  parseStructuredAddress,
  parseDocumentDob,
  calculateEmployixScore,
  calculateKycStatus,
} = require('../../../../helpers/documentHelper');

const getSurepassToken = () => {
  return process.env.SUREPASS_API_TOKEN || process.env.SUREPASS_TOKEN || null;
};

const getSurepassBaseUrl = () => {
  const token = getSurepassToken();
  const configuredUrl = process.env.SUREPASS_BASE_URL;
  if (configuredUrl) {
    // If the token is a sandbox/dev token but URL is pointing to production kyc-api, auto-switch to sandbox
    if (token && token.includes('dev.') && configuredUrl.includes('kyc-api.surepass.io')) {
      return 'https://sandbox.surepass.io';
    }
    return configuredUrl.replace(/\/+$/, '');
  }
  return 'https://sandbox.surepass.io';
};

const sanitizeRedirectUrlForWaf = (urlStr) => {
  if (!urlStr || typeof urlStr !== 'string') return urlStr;
  try {
    const parsed = new URL(urlStr);
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      parsed.hostname = 'localtest.me';
      return parsed.toString();
    }
    const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      // Surepass WAF blocks raw IPv4 digits (e.g. 13.232.68.44) in payloads with 403 Forbidden HTML.
      // nip.io safely resolves hyphenated IPs (13-232-68-44.nip.io) directly to the target server IP in DNS.
      parsed.hostname = ipMatch.slice(1, 5).join('-') + '.nip.io';
      return parsed.toString();
    }
    return urlStr;
  } catch {
    return urlStr
      .replace(/:\/\/127\.0\.0\.1/g, '://localtest.me')
      .replace(/:\/\/localhost/g, '://localtest.me')
      .replace(/:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})/g, '://$1-$2-$3-$4.nip.io');
  }
};

const getSurepassHeaders = (token) => ({
  Authorization: `Bearer ${token.trim()}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
});

/**
 * Step 1: Initialize DigiLocker Session (Create Link API)
 * POST https://sandbox.surepass.io/api/v1/digilocker/initialize
 */
const initializeDigilockerSession = async ({
  userId,
  redirectUrl,
  config = {},
  correlationId = 'N/A',
}) => {
  const token = getSurepassToken();
  if (!token) {
    const error = new Error('Surepass API token is not configured. Please set SUREPASS_API_TOKEN in backend .env');
    error.statusCode = 500;
    throw error;
  }

  const baseUrl = getSurepassBaseUrl();
  const rawRedirectUrl =
    redirectUrl ||
    (process.env.CLIENT_APP_URL
      ? `${process.env.CLIENT_APP_URL}/kyc-verification?step=education`
      : `${process.env.FRONTEND_URL || 'http://localhost:5173'}/kyc-verification?step=education`);

  const sanitizedRedirectUrl = sanitizeRedirectUrlForWaf(rawRedirectUrl);

  const primaryEndpoint =
    process.env.SUREPASS_DIGILOCKER_INITIALIZE_URL || `${baseUrl}/api/v1/digilocker/initialize`;

  // Surepass initialize API expects parameters nested inside { data: { ... } }
  const requestPayload = {
    data: {
      redirect_url: sanitizedRedirectUrl,
      callback_url: sanitizedRedirectUrl,
      consent: 'Y',
      consent_purpose: 'Voluntary consent to verify educational degrees, marksheets and certifications via DigiLocker and NAD',
      ...config,
    },
  };

  const headers = getSurepassHeaders(token);

  console.log('\n================== [DIGILOCKER INITIALIZE DEBUG] ==================');
  console.log('User ID:', userId);
  console.log('Endpoint:', primaryEndpoint);
  console.log('Token (masked):', `${token.slice(0, 15)}...${token.slice(-6)}`);
  console.log('Sanitized Redirect URL:', sanitizedRedirectUrl);
  console.log('Payload:', JSON.stringify(requestPayload, null, 2));

  logger.info('Initializing Surepass DigiLocker session', {
    correlationId,
    userId,
    targetUrl: primaryEndpoint,
    redirectUrl: sanitizedRedirectUrl,
  });

  let responseData = null;
  try {
    const response = await axios.post(primaryEndpoint, requestPayload, {
      headers,
      timeout: 30000,
    });
    responseData = response.data;
    console.log('Surepass Response Status:', response.status);
    console.log('Surepass Response Data:', JSON.stringify(responseData, null, 2));
    console.log('===================================================================\n');
  } catch (primaryErr) {
    const primaryStatus = primaryErr.response?.status;
    const errorMsg =
      primaryErr.response?.data?.message ||
      primaryErr.response?.data?.error ||
      primaryErr.message;
    console.log('Surepass Axios Failed!');
    console.log('Status:', primaryStatus);
    console.log('Error Message:', errorMsg);
    console.log('Response Body:', primaryErr.response?.data);
    console.log('===================================================================\n');

    logger.error('Surepass initialize endpoint failed', {
      correlationId,
      status: primaryStatus,
      message: errorMsg,
      details: primaryErr.response?.data,
    });

    const err = new Error(`Surepass DigiLocker initialization failed: ${errorMsg}`);
    err.statusCode = primaryStatus || 502;
    err.details = primaryErr.response?.data;
    throw err;
  }

  // Robust parsing of client_id and url from Surepass response
  const rawData = responseData?.data || responseData;
  const clientId =
    rawData?.client_id ||
    rawData?.clientId ||
    rawData?.id ||
    responseData?.client_id;
  const digilockerUrl =
    rawData?.url ||
    rawData?.link ||
    rawData?.digilocker_link ||
    responseData?.url;

  if (!clientId || !digilockerUrl) {
    logger.error('Surepass returned unexpected response format without client_id or url', {
      correlationId,
      userId,
      responseData,
    });
    const err = new Error('Invalid response received from Surepass DigiLocker gateway. Missing client_id or url.');
    err.statusCode = 502;
    err.details = responseData;
    throw err;
  }

  // Save session record in DB
  const session = await DigilockerSession.findOneAndUpdate(
    { clientId },
    {
      userId,
      clientId,
      initialUrl: digilockerUrl,
      redirectUrl: sanitizedRedirectUrl,
      status: 'initialized',
      consentGiven: true,
      consentTimestamp: new Date(),
      consentPurpose: config?.consent_purpose || 'Voluntary consent to verify educational degrees, marksheets and certifications',
      config,
      rawInitializeResponse: responseData,
    },
    { upsert: true, new: true }
  );

  logger.info('DigiLocker session initialized successfully', {
    correlationId,
    userId,
    clientId,
    sessionId: session._id,
  });

  return {
    success: true,
    clientId,
    url: digilockerUrl,
    redirectUrl: sanitizedRedirectUrl,
    sessionId: session._id,
  };
};

/**
 * Normalizes document type string to known system types
 */
const normalizeDocType = (typeStr = '', rawTitle = '') => {
  const combined = `${typeStr} ${rawTitle}`.toLowerCase();
  if (combined.includes('aadhaar') || combined.includes('adhar') || combined.includes('uidai')) {
    return 'aadhaar';
  }
  if (combined.includes('pan') || combined.includes('pancr')) {
    return 'pan';
  }
  if (
    combined.includes('marksheet') ||
    combined.includes('degree') ||
    combined.includes('diploma') ||
    combined.includes('cbse') ||
    combined.includes('passing') ||
    combined.includes('education') ||
    combined.includes('10th') ||
    combined.includes('12th') ||
    combined.includes('hsc') ||
    combined.includes('ssc')
  ) {
    return 'marksheet';
  }
  if (
    combined.includes('certificate') ||
    combined.includes('certification') ||
    combined.includes('skill') ||
    combined.includes('credential') ||
    combined.includes('course')
  ) {
    return 'certification';
  }
  if (combined.includes('driving') || combined.includes('license') || combined.includes('dl')) {
    return 'driving_license';
  }
  if (combined.includes('voter') || combined.includes('epic') || combined.includes('election')) {
    return 'voter_id';
  }
  return 'other';
};

/**
 * Step 2: Fetch Verified Documents & Parse Data
 * GET https://kyc-api.surepass.io/api/v1/digilocker/get-documents/{client_id}
 */
const fetchAndProcessDigilockerDocuments = async ({
  clientId,
  userId = null,
  correlationId = 'N/A',
  reqIp = null,
  userAgent = null,
}) => {
  const token = getSurepassToken();
  if (!token) {
    const error = new Error('Surepass API token is not configured. Please set SUREPASS_API_TOKEN in backend .env');
    error.statusCode = 500;
    throw error;
  }

  if (!clientId) {
    const error = new Error('Client ID is required to fetch DigiLocker verified documents');
    error.statusCode = 400;
    throw error;
  }

  // Look up existing session or create if missing
  let session = await DigilockerSession.findOne({ clientId });
  const activeUserId = userId || session?.userId;

  if (!activeUserId) {
    const error = new Error('Associated user not found for this DigiLocker session');
    error.statusCode = 404;
    throw error;
  }

  if (!session) {
    session = await DigilockerSession.create({
      userId: activeUserId,
      clientId,
      initialUrl: 'N/A',
      status: 'processing',
    });
  }

  const baseUrl = getSurepassBaseUrl();
  logger.info('Fetching DigiLocker status and documents from Surepass', {
    correlationId,
    clientId,
    userId: activeUserId,
  });

  // 1. Check DigiLocker session status from Surepass
  let statusData = null;
  try {
    const statusUrl = `${baseUrl}/api/v1/digilocker/status/${encodeURIComponent(clientId)}`;
    const statusRes = await axios.get(statusUrl, {
      headers: getSurepassHeaders(token),
      timeout: 25000,
    });
    statusData = statusRes.data?.data || statusRes.data;
  } catch (statusErr) {
    logger.warn('Surepass digilocker status check failed, proceeding to list-documents', {
      correlationId,
      clientId,
      error: statusErr.message,
    });
  }

  if (
    statusData &&
    (statusData.completed === false ||
      ['client_initiated', 'pending', 'initiated', 'waiting'].includes(String(statusData.status || '').toLowerCase()))
  ) {
    if (session) {
      session.status = 'processing';
      await session.save();
    }
    return {
      success: false,
      isPending: true,
      status: statusData.status || 'pending',
      clientId,
      message: 'DigiLocker verification is still in progress. Please complete authentication and consent on DigiLocker.',
    };
  }

  // 2. Fetch list of verified documents from Surepass list-documents API
  const rawDocs = [];
  try {
    const listDocsUrl = `${baseUrl}/api/v1/digilocker/list-documents/${encodeURIComponent(clientId)}`;
    const listRes = await axios.get(listDocsUrl, {
      headers: getSurepassHeaders(token),
      timeout: 30000,
    });
    const docs = listRes.data?.data?.documents || listRes.data?.documents || [];
    if (Array.isArray(docs)) {
      rawDocs.push(...docs);
    }
  } catch (listErr) {
    logger.warn('Surepass list-documents API failed, falling back to alternative payload checks', {
      correlationId,
      clientId,
      error: listErr.message,
    });
  }

  // Check if session had any cached documents if list-documents was empty
  if (rawDocs.length === 0 && session?.documents?.length > 0) {
    rawDocs.push(...session.documents);
  }

  // 3. For each document, retrieve download URL from download-document API in parallel
  await Promise.all(
    rawDocs.map(async (doc) => {
      const fileId = doc.file_id || doc.fileId || doc.id || null;
      if (!doc.download_url && !doc.url && !doc.link && !doc.documentUrl && fileId) {
        try {
          const dlRes = await axios.get(
            `${baseUrl}/api/v1/digilocker/download-document/${encodeURIComponent(clientId)}/${encodeURIComponent(fileId)}`,
            {
              headers: getSurepassHeaders(token),
              timeout: 10000,
            }
          );
          doc.download_url = dlRes.data?.data?.download_url || null;
          if (dlRes.data?.data?.mime_type) {
            doc.mime_type = dlRes.data?.data?.mime_type;
          }
        } catch (dlErr) {
          logger.warn('Could not fetch download url for DigiLocker file', {
            clientId,
            fileId,
            error: dlErr.message,
          });
        }
      }
    })
  );

  const processedDocs = [];
  let marksheetCount = 0;
  let certCount = 0;

  const seenKeys = new Set();

  for (const doc of rawDocs) {
    const fileId = doc.file_id || doc.fileId || doc.id || null;
    const rawType = doc.doc_type || doc.type || doc.document_type || doc.name || '';
    const normType = normalizeDocType(rawType, doc.title || doc.name || doc.description || '');
    const docName = doc.name || doc.title || doc.description || `${normType.toUpperCase()} Document`;
    const issuer = doc.issuer || doc.organization || doc.board || 'DigiLocker / National Academic Depository';
    const fileType = doc.file_type || (doc.mime_type?.includes('pdf') ? 'pdf' : 'pdf');

    // Prevent duplicate entries of the same document name and type
    const docKey = `${normType}_${docName}_${issuer}`.toLowerCase();
    if (seenKeys.has(docKey)) continue;
    seenKeys.add(docKey);

    const downloadUrl = doc.download_url || doc.url || doc.link || doc.documentUrl || null;
    const mimeType = doc.mime_type || (fileType === 'pdf' ? 'application/pdf' : 'application/xml');

    const docNumber =
      doc.document_number ||
      doc.doc_number ||
      doc.id_number ||
      doc.aadhaar_number ||
      doc.pan_number ||
      doc.number ||
      null;

    const maskedNumber =
      doc.masked_number ||
      doc.masked_aadhaar ||
      doc.masked_pan ||
      maskDocumentNumber(docNumber);

    const processedItem = {
      fileId,
      docType: normType,
      docName,
      docNumber,
      maskedDocNumber: maskedNumber,
      downloadUrl,
      issuer,
      description: doc.description || docName,
      fileType,
      mimeType,
      isVerified: true,
      verificationMethod: 'DigiLocker',
      verifiedAt: new Date(),
      rawMetadata: doc,
    };

    // 1. Process Marksheets, Academic Degrees & Diplomas
    const isMarksheet =
      normType === 'marksheet' ||
      docName.toLowerCase().includes('marksheet') ||
      docName.toLowerCase().includes('degree') ||
      docName.toLowerCase().includes('diploma') ||
      docName.toLowerCase().includes('cbse') ||
      docName.toLowerCase().includes('academic') ||
      docName.toLowerCase().includes('board') ||
      docName.toLowerCase().includes('university') ||
      issuer.toLowerCase().includes('education') ||
      issuer.toLowerCase().includes('board') ||
      issuer.toLowerCase().includes('university') ||
      issuer.toLowerCase().includes('cbse');

    // 2. Process Professional Certifications
    const isCert =
      normType === 'certification' ||
      docName.toLowerCase().includes('certificat') ||
      docName.toLowerCase().includes('course');

    if (isMarksheet) {
      marksheetCount++;
      processedDocs.push(processedItem);
      await Qualification.findOneAndUpdate(
        { userId: activeUserId, degree: docName },
        {
          userId: activeUserId,
          degree: docName,
          institution: issuer,
          year: String(new Date().getFullYear()),
          documentUrl: downloadUrl,
          isVerified: true,
          verificationStatus: 'verified',
          verificationMethod: 'DigiLocker',
          badge: 'DigiLocker Verified',
        },
        { upsert: true, new: true }
      );
    } else if (isCert) {
      certCount++;
      processedDocs.push(processedItem);
      await Certification.findOneAndUpdate(
        { userId: activeUserId, title: docName },
        {
          userId: activeUserId,
          title: docName,
          issuer,
          year: String(new Date().getFullYear()),
          documentUrl: downloadUrl,
          isVerified: true,
          verificationStatus: 'verified',
          verificationMethod: 'DigiLocker',
          badge: 'DigiLocker Verified',
        },
        { upsert: true, new: true }
      );
    }
  }

  // Calculate updated score & KYC state with verified education (+20 pts only if real education docs found)
  const existingUser = await User.findById(activeUserId);
  const completedRefCount = await Referral.countDocuments({
    referrerId: activeUserId,
    $or: [{ isFeedbackSubmitted: true }, { status: 'completed' }, { isPointsAwarded: true }],
  });

  const hasEducationDocs = processedDocs.length > 0;

  const [rawEpfoDocs, epfoVerifs] = await Promise.all([
    EmploymentVerification.find({ userId: activeUserId }).lean(),
    Identification.find({ userId: activeUserId, verificationStatus: 'verified' }).lean(),
  ]);
  const hasEpfo = Array.isArray(rawEpfoDocs) && rawEpfoDocs.length > 0;
  const isAadhaarDone = existingUser?.aadhaarStatus === 1 || epfoVerifs.some(i => i.documentType === 'aadhaar');
  const isVoterDone = existingUser?.voterStatus === 1 || epfoVerifs.some(i => i.documentType === 'voter_id');
  const isDlDone = existingUser?.dlStatus === 1 || epfoVerifs.some(i => i.documentType === 'driving_license');
  const isEmpDone = existingUser?.employmentStatus === 1 || hasEpfo;

  const newScore = await calculateEmployixScore({
    aadhaarDone: isAadhaarDone,
    voterDone: isVoterDone,
    dlDone: isDlDone,
    empDone: isEmpDone,
    eduDone: hasEducationDocs,
    verifiedReferencesCount: completedRefCount,
  });

  const newKycState = calculateKycStatus({
    aadhaarDone: isAadhaarDone,
    voterDone: isVoterDone,
    dlDone: isDlDone,
    empDone: isEmpDone,
    eduDone: hasEducationDocs,
  });

  await User.findByIdAndUpdate(activeUserId, {
    $set: {
      kycStatus: existingUser?.kycStatus === 8 ? 8 : newKycState,
      employixScore: newScore,
      isVerified: existingUser?.isVerified || false,
      educationStatus: hasEducationDocs ? 1 : (existingUser?.educationStatus || 0),
    },
  });

  // Update session record
  if (session) {
    session.status = 'completed';
    session.documents = processedDocs;
    session.rawDocumentsResponse = { documents: rawDocs };
    await session.save();
  }

  logger.info('DigiLocker documents processed and saved successfully', {
    correlationId,
    clientId,
    userId: activeUserId,
    docsCount: processedDocs.length,
    score: newScore,
    kycStatus: existingUser?.kycStatus === 8 ? 8 : newKycState,
  });

  // Retrieve latest qualifications & certifications for instant frontend state sync
  const [refreshedQuals, refreshedCerts] = await Promise.all([
    Qualification.find({ userId: activeUserId }).sort({ createdAt: -1 }).lean(),
    Certification.find({ userId: activeUserId }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    success: true,
    clientId,
    documentsCount: processedDocs.length,
    documents: processedDocs,
    qualifications: refreshedQuals,
    certifications: refreshedCerts,
    verificationSummary: {
      educationVerified: true,
      marksheetCount,
      certCount,
    },
    newScore,
    employixScore: newScore,
    score: newScore,
    newKycState,
    kycStatus: existingUser?.kycStatus === 8 ? 8 : newKycState,
    message: 'DigiLocker verified education documents fetched and saved successfully',
  };
};

module.exports = {
  initializeDigilockerSession,
  fetchAndProcessDigilockerDocuments,
};
