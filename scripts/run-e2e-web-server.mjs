import { spawn } from "node:child_process";

const port = process.argv[2] ?? "3100";
const environment = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "CI", "NEXT_TELEMETRY_DISABLED"]
    .map((key) => [key, process.env[key]])
    .filter((entry) => typeof entry[1] === "string")
);
Object.assign(environment, {
  E2E_TEST_FIXTURES: "1",
  NEXT_PUBLIC_API_URL: "http://localhost:3001",
  NEXT_PUBLIC_E2E_TEST_FIXTURES: "1",
  NODE_ENV: "development"
});

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(command, ["run", "dev:web", "--", "-p", port], {
  cwd: process.cwd(),
  env: environment,
  stdio: "inherit"
});

function forward(signal) {
  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.on("error", (error) => {
  console.error("Unable to start the E2E web server.", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
