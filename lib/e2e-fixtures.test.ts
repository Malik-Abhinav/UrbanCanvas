import { describe, expect, it } from "vitest";
import {
  E2E_FIXTURE_PRODUCTION_ERROR,
  isE2eFixtureServerEnabled,
  sanitizeE2eFixtureEnvironment
} from "./e2e-fixtures";

function environment(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { ...overrides, NODE_ENV: overrides.NODE_ENV ?? "test" } as NodeJS.ProcessEnv;
}

describe("isE2eFixtureServerEnabled", () => {
  it("stays disabled when neither flag is set", () => {
    expect(isE2eFixtureServerEnabled(environment())).toBe(false);
  });

  it("stays disabled in production when neither flag is requested", () => {
    expect(isE2eFixtureServerEnabled(environment({ NODE_ENV: "production" }))).toBe(false);
  });

  it("enables fixtures only when both non-production flags are set", () => {
    expect(
      isE2eFixtureServerEnabled(
        environment({ E2E_TEST_FIXTURES: "1", NEXT_PUBLIC_E2E_TEST_FIXTURES: "1" })
      )
    ).toBe(true);
  });

  it.each([
    { E2E_TEST_FIXTURES: "1" },
    { NEXT_PUBLIC_E2E_TEST_FIXTURES: "1" }
  ])("rejects mismatched fixture flags: %o", (flags) => {
    expect(() => isE2eFixtureServerEnabled(environment(flags))).toThrow(/require both/i);
  });

  it.each([
    { E2E_TEST_FIXTURES: "1" },
    { NEXT_PUBLIC_E2E_TEST_FIXTURES: "1" },
    { E2E_TEST_FIXTURES: "1", NEXT_PUBLIC_E2E_TEST_FIXTURES: "1" }
  ])("rejects every production fixture request: %o", (flags) => {
    expect(() =>
      isE2eFixtureServerEnabled(environment({ NODE_ENV: "production", ...flags }))
    ).toThrow(E2E_FIXTURE_PRODUCTION_ERROR);
  });

  it("removes provider credentials from an enabled fixture environment", () => {
    const fixtureEnvironment = environment({
      CLERK_PUBLISHABLE_KEY: "publishable",
      CLERK_SECRET_KEY: "secret",
      DATABASE_URL: "postgres://secret",
      E2E_TEST_FIXTURES: "1",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "public",
      NEXT_PUBLIC_E2E_TEST_FIXTURES: "1",
      NEXT_PUBLIC_MAPBOX_TOKEN: "mapbox"
    });

    expect(sanitizeE2eFixtureEnvironment(fixtureEnvironment)).toBe(true);
    expect(fixtureEnvironment).not.toHaveProperty("CLERK_PUBLISHABLE_KEY");
    expect(fixtureEnvironment).not.toHaveProperty("CLERK_SECRET_KEY");
    expect(fixtureEnvironment).not.toHaveProperty("DATABASE_URL");
    expect(fixtureEnvironment).not.toHaveProperty("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
    expect(fixtureEnvironment).not.toHaveProperty("NEXT_PUBLIC_MAPBOX_TOKEN");
    expect(fixtureEnvironment.NEXT_PUBLIC_API_URL).toBe("http://localhost:3001");
  });
});
