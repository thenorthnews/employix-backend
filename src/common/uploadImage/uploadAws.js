
const multer = require('multer');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');


const storage = multer.memoryStorage();
const upload = multer({
  storage,

  limits: {
    fileSize: 5 * 1024 * 1024, 
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
      cb(new Error('Only JPG, PNG and WEBP images are allowed'));
    }
  },
});



const s3Client = new S3Client({
  region: process.env.AWS_REGION,

  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});




const uploadProfileImage = async (file) => {
  if (!file) {
    return null;
  }
  const fileExtension = path.extname(file.originalname);
  const fileName = `profile-images/${Date.now()}-${Math.round(
    Math.random() * 1e9
  )}${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  });

  await s3Client.send(command);

  const imageUrl = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

  return imageUrl;
};




module.exports = {
  upload,
  uploadProfileImage,
}

