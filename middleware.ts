import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/__clerk(.*)"]);
const fixturesEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.E2E_TEST_FIXTURES === "1" &&
  process.env.NEXT_PUBLIC_E2E_TEST_FIXTURES === "1";

const protectedMiddleware = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export default fixturesEnabled
  ? function e2eFixtureMiddleware() {
      return NextResponse.next();
    }
  : protectedMiddleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
