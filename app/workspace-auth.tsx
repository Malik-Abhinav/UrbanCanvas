"use client";

import { Show, SignInButton, SignUpButton, UserButton, useAuth } from "@clerk/nextjs";

const fixturesEnabled =
  process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1";

type WorkspaceAuth = {
  getToken: () => Promise<string | null>;
  isSignedIn: boolean;
};

const getFixtureToken = async () => "e2e-fixture-token";

function useFixtureWorkspaceAuth(): WorkspaceAuth {
  return {
    getToken: getFixtureToken,
    isSignedIn: true
  };
}

function useClerkWorkspaceAuth(): WorkspaceAuth {
  const { getToken, isSignedIn } = useAuth();

  return {
    getToken,
    isSignedIn: Boolean(isSignedIn)
  };
}

export const useWorkspaceAuth = fixturesEnabled
  ? useFixtureWorkspaceAuth
  : useClerkWorkspaceAuth;

export function WorkspaceAuthControls({ collapsed }: { collapsed: boolean }) {
  if (fixturesEnabled) {
    return <span className={collapsed ? "hidden" : "text-xs text-white/45"}>Test workspace</span>;
  }

  return (
    <>
      <Show when="signed-out">
        <SignInButton mode="modal">
          <button
            className={`secondary-button px-2.5 py-1 text-xs ${collapsed ? "hidden" : ""}`}
            type="button"
          >
            Sign in
          </button>
        </SignInButton>
        <SignUpButton mode="modal">
          <button
            className={`primary-button px-2.5 py-1 text-xs ${collapsed ? "hidden" : ""}`}
            type="button"
          >
            Sign up
          </button>
        </SignUpButton>
      </Show>
      <Show when="signed-in">
        <UserButton />
      </Show>
    </>
  );
}
