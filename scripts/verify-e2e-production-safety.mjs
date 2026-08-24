import { existsSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const buildDirectory = path.join(cwd, ".next");
const backupDirectory = path.join(cwd, `.next-e2e-safety-backup-${process.pid}`);
const hadBuildDirectory = existsSync(buildDirectory);

if (hadBuildDirectory) {
  renameSync(buildDirectory, backupDirectory);
}

let result;
try {
  result = spawnSync("npm", ["run", "build:web"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      E2E_TEST_FIXTURES: "1",
      NEXT_PUBLIC_E2E_TEST_FIXTURES: "1",
      NODE_ENV: "production"
    }
  });
} finally {
  rmSync(buildDirectory, { force: true, recursive: true });
  if (hadBuildDirectory) {
    renameSync(backupDirectory, buildDirectory);
  }
}

const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
const sentinel = "E2E test fixtures are forbidden when NODE_ENV=production.";

if (result?.status === 0 || !output.includes(sentinel)) {
  process.stderr.write(output);
  throw new Error("Production build did not fail closed on E2E fixtures.");
}

console.log("PASS: production build rejected E2E fixtures before compilation without mutating .next.");
