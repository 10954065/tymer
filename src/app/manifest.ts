import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SmartLiving Buynfry Ventures POS",
    short_name: "SmartLiving",
    description: "Point of sale and business management for SMARTLIVING BUYNFRY VENTURES",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f3ee",
    theme_color: "#1f5c48",
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "New sale", url: "/pos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
