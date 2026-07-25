import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next ignores unrelated lockfiles elsewhere.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
