import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@company-os/contracts', '@company-os/world'],
  reactStrictMode: true,
  devIndicators: false,
  agentRules: false,
};
export default config;
