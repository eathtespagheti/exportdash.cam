const port = process.env.PORT || 3000;
const enableUploadBox = process.env.NEXT_PUBLIC_ENABLE_UPLOAD_BOX !== 'false';
const enableLibraryReview = process.env.NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW === 'true';
const clipsPath = process.env.LIBRARY_CLIPS_PATH || 'not configured';
console.log('\\n=========================================');
console.log('🚗 ExportDash Configuration (Runtime)');
console.log('📡 Listening on: http://0.0.0.0:' + port);
console.log('📤 Upload Box Enabled: ' + enableUploadBox);
console.log('📂 Library Review Enabled: ' + enableLibraryReview);
if (enableLibraryReview) {
  console.log('📁 Library Clips Path: ' + clipsPath);
}
console.log('=========================================\\n');
require('./server.js');