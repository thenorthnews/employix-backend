const fs = require('fs');
const { validateDocumentConsistency } = require('./src/helpers/documentClassifier');

async function run() {
  const frontPath = 'C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\499b4b0c-a902-481d-9366-ae4ae12ed90c\\.user_uploaded\\media_1790583424497.png';
  const backPath = 'C:\\Users\\Admin\\.gemini\\antigravity-ide\\brain\\499b4b0c-a902-481d-9366-ae4ae12ed90c\\.user_uploaded\\media_1790583399367.png';

  const frontBuffer = fs.readFileSync(frontPath);
  const backBuffer = fs.readFileSync(backPath);

  try {
    await validateDocumentConsistency({
      expectedType: 'driving_license',
      frontBuffer,
      backBuffer,
    });
    console.log('SUCCESS: BOTH IMAGES VALIDATED PERFECTLY!');
  } catch (err) {
    console.error('FAILED WITH ERROR:', err.message);
  }
}

run();
