import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConfigProvider } from "@/components/ConfigProvider";

// Force dynamic rendering to evaluate environment variables at runtime
export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ExportDash — Tesla Dashcam Viewer",
  description: "Tesla dashcam viewer with seamless playback, live telemetry overlays, and video export. 100% client-side, no uploads.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Evaluated dynamically on the server at runtime
  const runtimeConfig = {
    enableUploadBox: process.env.NEXT_PUBLIC_ENABLE_UPLOAD_BOX !== 'false',
    enableLibraryReview: process.env.NEXT_PUBLIC_ENABLE_LIBRARY_REVIEW === 'true',
  };

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ConfigProvider config={runtimeConfig}>
          {children}
        </ConfigProvider>
      </body>
    </html>
  );
}