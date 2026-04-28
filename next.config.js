/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  // PWA は本番環境のみ next-pwa を有効化（後で追加）
  // 開発時は SW なしで動かす方が楽
};

module.exports = nextConfig;
