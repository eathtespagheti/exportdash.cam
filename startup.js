const port = process.env.PORT || 3000;
const enableUploadBox = process.env.NEXT_PUBLIC_ENABLE_UPLOAD_BOX !== 'false';
const enableLibraryReview = process.env.NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW === 'true';
console.log('\n=========================================');
console.log('🚗 ExportDash Configuration (Runtime)');
console.log('📡 Listening on: http://0.0.0.0:' + port);
console.log('📤 Upload Box Enabled: ' + enableUploadBox);
console.log('📂 Library Review Enabled: ' + enableLibraryReview);
console.log('=========================================\n');
// server.js is the CommonJS bundle emitted by Next's standalone build.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require('./server.js');