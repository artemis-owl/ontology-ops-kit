// Read a previous revision of a file from git, so version-check can compare
// what you are about to merge against what is already released.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseDomain } from "./load.mjs";

const run = promisify(execFile);

export async function fileAtRev(file, rev) {
  try {
    const { stdout } = await run("git", ["show", `${rev}:${file}`], { maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return null; // new file at this revision, or rev unknown
  }
}

export async function domainAtRev(file, rev) {
  const raw = await fileAtRev(file, rev);
  if (raw === null) return null;
  return parseDomain(raw, `${rev}:${file}`);
}

// Pick a sensible comparison point: an explicit --base wins, then the merge-base
// with the default branch, then the previous commit.
export async function resolveBaseRev(explicit) {
  if (explicit) return explicit;
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const base = await mergeBase(candidate);
    if (base) return base;
  }
  return (await revParse("HEAD~1")) ?? null;
}

async function mergeBase(ref) {
  try {
    const { stdout } = await run("git", ["merge-base", "HEAD", ref]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function revParse(ref) {
  try {
    const { stdout } = await run("git", ["rev-parse", "--verify", ref]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
