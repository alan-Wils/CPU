/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["10.0.0.170"],
  env: {
    /** Inlined at build time on Vercel (`VERCEL_GIT_COMMIT_SHA`). Proves which bundle is live. */
    NEXT_PUBLIC_APP_GIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || "",
  },
};

module.exports = nextConfig;