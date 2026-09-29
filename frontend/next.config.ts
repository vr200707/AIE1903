import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 将 /api/* 代理到后端，避免浏览器跨域（CORS）
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
