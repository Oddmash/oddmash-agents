import type { NextConfig } from 'next';

const config: NextConfig = { transpilePackages: ['@oddmash/agent-operator-contract', '@oddmash/agent-operator-store'] };
export default config;
