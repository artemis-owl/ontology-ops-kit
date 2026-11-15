// Read a previous revision of the domain files from git, so version-check can
// compare what you are about to merge against what is already released.
//
// Every git call runs at the repository root, so paths are repository-relative
// whatever directory the CLI was started from.

import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseDomain } from "./load.mjs";

const run = promisify(execFile);
const git = (args, cwd) => run("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 });

// The top of the git repository containing `cwd`, or null when there is none.
export async function repoRoot(cwd = process.cwd()) {
  try {
    const { stdout } = await git(["rev-parse", "--show-toplevel"], cwd);
    return (await realpath(stdout.trim())) || null;
  } catch {
    return null;
  }
}

// `dir` (relative to cwd, or absolute) as a path relative to `root`, or null
// when it lies outside the repository. "." for the root itself.
export async function repoRelativeDir(root, dir, cwd = process.cwd()) {
  const absolute = path.resolve(cwd, dir);
  let real;
  try {
    real = await realpath(absolute);
  } catch {
    // Not on disk (yet, or any more): resolve the nearest parent that is.
    real = path.join(await realpath(path.dirname(absolute)).catch(() => path.dirname(absolute)), path.basename(absolute));
  }
  const rel = path.relative(root, real);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return (rel || ".").split(path.sep).join("/");
}

export async function fileAtRev(file, rev, root = process.cwd()) {
  try {
    const { stdout } = await git(["show", `${rev}:${file}`], root);
    return stdout;
  } catch {
    return null; // new file at this revision, or rev unknown
  }
}

export async function domainAtRev(file, rev, root = process.cwd()) {
  const raw = await fileAtRev(file, rev, root);
  if (raw === null) return null;
  return parseDomain(raw, `${rev}:${file}`);
}

// Every domain file directly under `dir` (repository-relative) at `rev`, parsed.
// Mirrors listDomainFiles: one level deep, *.yaml and *.yml. Each entry's `file`
// is the repository-relative path, so renames can be told apart from new files.
export async function domainsAtRev(dir, rev, root = process.cwd()) {
  const prefix = dir === "." ? "" : `${dir}/`;
  let stdout;
  try {
    ({ stdout } = await git(["ls-tree", "--name-only", "--full-tree", rev, "--", prefix || "."], root));
  } catch {
    return [];
  }
  const files = stdout
    .split("\n")
    .filter((name) => /\.ya?ml$/.test(name))
    .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes("/"))
    .sort();
  const out = [];
  for (const file of files) {
    const raw = await fileAtRev(file, rev, root);
    out.push(raw === null ? { file, doc: null, parseError: "unreadable at this revision" } : parseDomain(raw, file));
  }
  return out;
}

// Pick a sensible comparison point: an explicit --base wins (and must resolve to
// a commit, or this returns null), then the merge-base with the first of
// origin/main, origin/master, main, master that exists, then HEAD~1.
export async function resolveBaseRev(explicit, root = process.cwd()) {
  if (explicit) return revParse(`${explicit}^{commit}`, root);
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const base = await mergeBase(candidate, root);
    if (base) return base;
  }
  return (await revParse("HEAD~1^{commit}", root)) ?? null;
}

async function mergeBase(ref, root) {
  try {
    const { stdout } = await git(["merge-base", "HEAD", ref], root);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function revParse(ref, root) {
  try {
    const { stdout } = await git(["rev-parse", "--verify", "--quiet", ref], root);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
