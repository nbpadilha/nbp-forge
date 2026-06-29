#!/usr/bin/env node
// Installs git hooks as thin SHIMS that delegate to the versioned scripts/hooks/* files.
// The shim never carries logic, so the real hook (reviewed in git) can't drift from what runs.
// Zero deps. Cross-platform: hooks run under git's bundled sh (incl. Git for Windows).
//
//   node scripts/install-hooks.mjs          # install
//   node scripts/install-hooks.mjs --force   # overwrite a foreign pre-commit (it is backed up)

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const force = process.argv.includes("--force");
const SHIM_MARK = "nbp-forge hook shim";

function gitPath(arg) {
  return execSync(`git rev-parse ${arg}`, { encoding: "utf8" }).trim();
}

let hooksDir;
try {
  hooksDir = gitPath("--git-path hooks");
} catch {
  console.error("✗ not a git repository (run from inside the repo).");
  process.exit(1);
}
mkdirSync(hooksDir, { recursive: true });

const dest = join(hooksDir, "pre-commit");
if (existsSync(dest)) {
  const cur = readFileSync(dest, "utf8");
  if (!cur.includes(SHIM_MARK)) {
    if (!force) {
      console.error(`✗ a non-nbp-forge pre-commit already exists: ${dest}`);
      console.error("  re-run with --force to back it up (→ pre-commit.local.bak) and replace it.");
      process.exit(1);
    }
    renameSync(dest, dest + ".local.bak");
    console.log("• backed up existing pre-commit → pre-commit.local.bak");
  }
}

const shim = `#!/bin/sh
# ${SHIM_MARK} — delegates to the versioned hook; do not edit here, edit scripts/hooks/pre-commit.
hook="$(git rev-parse --show-toplevel)/scripts/hooks/pre-commit"
[ -x "$hook" ] || { echo "nbp-forge: hook not found or not executable: $hook"; exit 1; }
exec "$hook" "$@"
`;
writeFileSync(dest, shim);
try { chmodSync(dest, 0o755); } catch { /* Windows: chmod is a no-op, sh runs it anyway */ }
console.log(`✔ installed pre-commit hook → shim at ${dest}`);
console.log("  (delegates to scripts/hooks/pre-commit — edit that file to change behavior)");
