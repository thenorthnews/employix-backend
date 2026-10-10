
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');


// =====================================
// UPLOAD FOLDER
// =====================================

const uploadDir = path.join(
  __dirname,
  '../../uploads/profile-images'
);


// Folder automatically create hoga
try {
  if (fs.existsSync(uploadDir)) {
    const stat = fs.statSync(uploadDir);
    if (!stat.isDirectory()) {
      fs.unlinkSync(uploadDir);
      fs.mkdirSync(uploadDir, { recursive: true });
    }
  } else {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Error ensuring uploadDir directory:', err);
}

// =====================================
// MULTER STORAGE
// =====================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (fs.existsSync(uploadDir)) {
        const stat = fs.statSync(uploadDir);
        if (!stat.isDirectory()) {
          fs.unlinkSync(uploadDir);
          fs.mkdirSync(uploadDir, { recursive: true });
        }
      } else {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
    } catch (_) {}
    cb(null, uploadDir);
  },


  filename: (req, file, cb) => {

    const extension = path.extname(file.originalname);

    const fileName = `${uuidv4()}${extension}`;

    cb(null, fileName);
  },

});


// =====================================
// PROFILE IMAGE UPLOAD
// =====================================

const ALL_IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
  'application/octet-stream',
];

const ALL_IMAGE_EXTS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
];

const ALL_DOC_EXTS = [...ALL_IMAGE_EXTS, '.pdf'];
const ALL_DOC_MIMES = [...ALL_IMAGE_MIMES, 'application/pdf'];

const uploadProfileImage = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (mime.startsWith('image/') || ALL_IMAGE_MIMES.includes(mime) || ALL_IMAGE_EXTS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Supported formats: JPEG, PNG, HEIC, WEBP.'));
    }
  },
});

// =====================================
// VERIFICATION DOCUMENTS UPLOAD (RAM BUFFER / ZERO-DISK)
// =====================================

const uploadVerificationDocs = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      ALL_DOC_MIMES.includes(mime) ||
      ALL_DOC_EXTS.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Supported formats: JPEG, PNG, HEIC, WEBP, PDF.'));
    }
  },
});

// =====================================
// PERSISTENT DOCUMENT ATTACHMENTS (DISK STORAGE)
// =====================================
const docUploadDir = path.join(__dirname, '../../uploads/documents');
try {
  if (fs.existsSync(docUploadDir)) {
    const stat = fs.statSync(docUploadDir);
    if (!stat.isDirectory()) {
      fs.unlinkSync(docUploadDir);
      fs.mkdirSync(docUploadDir, { recursive: true });
    }
  } else {
    fs.mkdirSync(docUploadDir, { recursive: true });
  }
} catch (err) {
  console.error('Error ensuring docUploadDir directory:', err);
}

const docStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      if (fs.existsSync(docUploadDir)) {
        const stat = fs.statSync(docUploadDir);
        if (!stat.isDirectory()) {
          fs.unlinkSync(docUploadDir);
          fs.mkdirSync(docUploadDir, { recursive: true });
        }
      } else {
        fs.mkdirSync(docUploadDir, { recursive: true });
      }
    } catch (_) {}
    cb(null, docUploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    const fileName = `${uuidv4()}${extension}`;
    cb(null, fileName);
  },
});

const uploadDocument = multer({
  storage: docStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();

    if (
      mime.startsWith('image/') ||
      mime === 'application/pdf' ||
      ALL_DOC_MIMES.includes(mime) ||
      ALL_DOC_EXTS.includes(ext)
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Supported formats: JPEG, PNG, HEIC, WEBP, GIF, BMP, PDF.'));
    }
  },
});

module.exports = {
  uploadProfileImage,
  uploadVerificationDocs,
  uploadDocument,
};

