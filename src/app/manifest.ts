import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kompass",
    short_name: "Kompass",
    description: "Study & life command center synced with Studium",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#0f1115",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    // long-press / right-click shortcuts on the installed app
    shortcuts: [
      { name: "Snabbfångst", url: "/capture" },
      { name: "Vecka", url: "/week" },
      { name: "Planera", url: "/plan" },
    ],
  };
}
