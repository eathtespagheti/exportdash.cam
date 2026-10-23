import type { NextConfig } from "next";

const enableUploadBox = process.env.NEXT_PUBLIC_ENABLE_UPLOAD_BOX !== "false";
const enableLibraryReview = process.env.NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW === "true";
const clipsPath = process.env.LIBRARY_CLIPS_PATH || "not configured";
const port = process.env.PORT || 3000;

console.log("\n=========================================");
console.log("🚗 ExportDash Configuration");
console.log(`📡 Listening on: http://localhost:${port}`);
console.log(`📤 Upload Box Enabled: ${enableUploadBox}`);
console.log(`📂 Library Review Enabled: ${enableLibraryReview}`);
if (enableLibraryReview) {
  console.log(`📁 Library Clips Path: ${clipsPath}`);
}
console.log("=========================================\n");

const nextConfig: NextConfig = {
  // The library feature serves clips from server-side API routes, so the app
  // ships as a standalone Node server rather than a static export.
  output: "standalone",
  images: {
    unoptimized: true,
  },
  // Proxy the Tesla decryption-key endpoint through the app server so the
  // browser makes a same-origin request (no CORS). This works in development
  // and in the standalone production container.
  async rewrites() {
    return [
      {
        source: "/tesla-decrypt/:path*",
        destination: "https://dashcam.tesla.com/:path*",
      },
      // The TeslaMate integration calls /grafana-proxy/...; relay it to the
      // route handler, which forwards only the two read-only endpoints it
      // needs. Keeping this as a rewrite means the client's configured base
      // URL is the same in development and in production.
      {
        source: "/grafana-proxy/:path*",
        destination: "/api/grafana-proxy/:path*",
      },
    ];
  },
};

export default nextConfig;
