/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.shuhaige.net" },
      { protocol: "https", hostname: "**.shuhaige.net" },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // The repo lives on an NTFS mount (/run/media/...) where inotify
  // doesn't fire on file saves — Next dev silently keeps the old
  // module graph until the next hard refresh. Forcing polling
  // restores hot-reload on this filesystem without affecting native
  // ext4/btrfs builds (cheap when there are no events).
  webpack: (config) => {
    config.watchOptions = {
      poll: 1000,
      ignored: /node_modules/,
    };
    return config;
  },
  // Allow LAN devices to load the dev server when started with
  // `next dev -H 0.0.0.0`. Without this, Next 15 rejects unknown Host
  // headers (e.g. http://192.168.1.71:3000) with a 400 / "Invalid Host
  // header" error. Pattern syntax matches the same shape used by
  // `images.remotePatterns`.
  allowedDevOrigins: [
    "192.168.*",
    "10.*",
    "172.16.*",
    "172.17.*",
    "172.18.*",
    "172.19.*",
    "172.20.*",
    "172.21.*",
    "172.22.*",
    "172.23.*",
    "172.24.*",
    "172.25.*",
    "172.26.*",
    "172.27.*",
    "172.28.*",
    "172.29.*",
    "172.30.*",
    "172.31.*",
    "127.0.0.1",
    "localhost",
  ],
};

export default nextConfig;
