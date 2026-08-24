import type { NextConfig } from "next";
import { sanitizeE2eFixtureEnvironment } from "./lib/e2e-fixtures";

// Fail closed in production and remove local provider credentials from E2E dev servers.
sanitizeE2eFixtureEnvironment();

const nextConfig: NextConfig = {};

export default nextConfig;
