import type { NextConfig } from "next";
import path from "node:path";

// Dependencies are hoisted to the workspace root, so both Turbopack and the
// standalone tracer need to look at the repository root rather than this folder.
const repoRoot = path.resolve(import.meta.dirname, "..");

const nextConfig: NextConfig = {
  // Produce a self-contained server bundle for the runtime Docker image.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
};

export default nextConfig;
