export const E2E_FIXTURE_PRODUCTION_ERROR =
  "E2E test fixtures are forbidden when NODE_ENV=production.";
const fixtureSensitiveKeys = [
  "CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "DATABASE_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN"
] as const;

export function isE2eFixtureServerEnabled(environment: NodeJS.ProcessEnv = process.env) {
  const serverRequested = environment.E2E_TEST_FIXTURES === "1";
  const clientRequested = environment.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1";

  if (environment.NODE_ENV === "production" && (serverRequested || clientRequested)) {
    throw new Error(E2E_FIXTURE_PRODUCTION_ERROR);
  }

  if (serverRequested !== clientRequested) {
    throw new Error(
      "E2E fixtures require both E2E_TEST_FIXTURES=1 and NEXT_PUBLIC_E2E_TEST_FIXTURES=1."
    );
  }

  return environment.NODE_ENV !== "production" && serverRequested && clientRequested;
}

export function sanitizeE2eFixtureEnvironment(environment: NodeJS.ProcessEnv = process.env) {
  if (!isE2eFixtureServerEnabled(environment)) {
    return false;
  }

  for (const key of fixtureSensitiveKeys) {
    delete environment[key];
  }
  environment.NEXT_PUBLIC_API_URL = "http://localhost:3001";
  return true;
}
