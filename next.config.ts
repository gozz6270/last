import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      // pdf-parse를 외부 모듈로 처리하여 번들링 제외
      config.externals = config.externals || [];
      config.externals.push("pdf-parse");

      // 또는 특정 파일들을 무시
      config.resolve = config.resolve || {};
      config.resolve.alias = config.resolve.alias || {};
      config.resolve.alias["pdf-parse$"] = require.resolve("pdf-parse");
    }
    return config;
  },
};

export default nextConfig;
