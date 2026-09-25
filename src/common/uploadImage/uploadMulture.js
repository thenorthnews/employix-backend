
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

const uploadProfileImage = multer({

  storage,

  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },


  fileFilter: (req, file, cb) => {

    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/webp',
    ];


    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Only JPG, PNG and WEBP images are allowed'
        )
      );
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
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/pdf',
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          'Invalid file format. Only JPEG, PNG, JPG, and PDF are allowed'
        )
      );
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
    fileSize: 10 * 1024 * 1024, // 10 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'image/webp',
      'application/pdf',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file format. Only JPG, PNG, WEBP, and PDF are allowed'));
    }
  },
});

module.exports = {
  uploadProfileImage,
  uploadVerificationDocs,
  uploadDocument,
};

