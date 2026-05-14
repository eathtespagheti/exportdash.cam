import type { NextConfig } from "next";

const enableUploadBox = process.env.NEXT_PUBLIC_ENABLE_UPLOAD_BOX !== 'false';
const enableLibraryReview = process.env.NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW === 'true';
const port = process.env.PORT || 3000;

console.log('\n=========================================');
console.log('🚗 ExportDash Configuration');
console.log(`📡 Listening on: http://localhost:${port}`);
console.log(`📤 Upload Box Enabled: ${enableUploadBox}`);
console.log(`📂 Library Review Enabled: ${enableLibraryReview}`);
console.log('=========================================\n');

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;