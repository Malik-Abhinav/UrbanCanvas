import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const roots = [path.join(process.cwd(), ".next", "static"), path.join(process.cwd(), ".next", "server")];
const forbidden = [
  "E2E fixture",
  "Test workspace",
  "createE2eFixtureMap",
  "e2e-fixture-token",
  "e2e-fixture-user",
  "e2eFixtureMiddleware",
  "NEXT_PUBLIC_E2E_TEST_FIXTURES",
  "E2E_TEST_FIXTURES"
];
const findings = [];

function inspect(directory) {
  for (const entry of readdirSync(directory)) {
    const target = path.join(directory, entry);
    const stats = statSync(target);
    if (stats.isDirectory()) {
      inspect(target);
      continue;
    }
    if (!target.endsWith(".js")) {
      continue;
    }
    const content = readFileSync(target, "utf8");
    const matches = forbidden.filter((term) => content.includes(term));
    if (matches.length > 0) {
      findings.push(`${path.relative(process.cwd(), target)}: ${matches.join(", ")}`);
    }
  }
}

for (const root of roots) {
  inspect(root);
}

if (findings.length > 0) {
  throw new Error(`Production executable bundles contain E2E fixture code:\n${findings.join("\n")}`);
}

console.log("PASS: production executable bundles contain no E2E fixture code or flags.");
