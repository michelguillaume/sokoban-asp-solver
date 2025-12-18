import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const backendUrl = (process.env.BACKEND_API_URL || 'http://localhost:4000').replace(/\/$/, '');
    const destination = backendUrl.endsWith('/api')
      ? `${backendUrl}/:path*`
      : `${backendUrl}/api/:path*`;

    return [
      {
        source: '/api-proxy/:path*',
        destination: destination,
      },
    ];
  },
};

export default nextConfig;
