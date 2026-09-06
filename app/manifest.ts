import type { MetadataRoute } from "next";

// Served automatically at /manifest.webmanifest, with Next.js injecting the
// <link rel="manifest"> tag - this is what lets "Add to Home Screen" (and
// Chrome's install prompt) launch the dialer full-screen with its own icon
// instead of as a bookmark in a browser tab.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Business Caller",
    short_name: "Business Caller",
    description: "Browser-based outbound dialer for the business Twilio line.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0d10",
    theme_color: "#0c0d10",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
