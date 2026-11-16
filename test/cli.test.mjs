// Drive the CLI in a throwaway git repository, made fresh for each test, so what
// is tested is what a user or CI actually runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(KIT, "bin", "ontology-ops.mjs");
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};

// A repository holding a copy of the kit's example domains in one commit.
function scratchRepo(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "ontology-ops-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(KIT, "domains"), path.join(dir, "domains"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: GIT_ENV, stdio: "pipe" }).toString();
  git("init", "--quiet", "--initial-branch=main");
  git("add", ".");
  git("commit", "--quiet", "-m", "base");
  return { dir, git };
}

function cli(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: GIT_ENV, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr, stdout: r.stdout, stderr: r.stderr };
}

// (A) removed and renamed domains

test("version-check fails when a domain is removed", (t) => {
  const { dir, git } = scratchRepo(t);
  git("rm", "--quiet", "domains/support-domain.yaml");
  const r = cli(dir, "version-check", "--base", "HEAD");
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /✗ support-domain: domain removed — every term in it is gone/);
  assert.doesNotMatch(r.out, /Version bumps cover/);
});

test("--allow-removed reports a removed domain without failing", (t) => {
  const { dir, git } = scratchRepo(t);
  git("rm", "--quiet", "domains/support-domain.yaml");
  const r = cli(dir, "version-check", "--base", "HEAD", "--allow-removed");
  assert.equal(r.status, 0, r.out);
  assert.match(r.stderr, /✗ support-domain: domain removed — every term in it is gone/);
  assert.match(r.stdout, /accepted by --allow-removed/);
});

test("a domain whose metadata.name changed is a removal", (t) => {
  const { dir } = scratchRepo(t);
  const file = path.join(dir, "domains", "support-domain.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace("name: support-domain", "name: helpdesk-domain"));
  const r = cli(dir, "version-check", "--base", "HEAD");
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /✗ support-domain: domain removed/);
  assert.match(r.stdout, /\+ domains\/support-domain\.yaml: new domain/);
});

test("a file renamed with its metadata.name kept is compared against its old content", (t) => {
  const { dir, git } = scratchRepo(t);
  git("mv", "domains/support-domain.yaml", "domains/support.yaml");
  const same = cli(dir, "version-check", "--base", "HEAD");
  assert.equal(same.status, 0, same.out);
  assert.match(same.stdout, /= domains\/support\.yaml \(was domains\/support-domain\.yaml\): unchanged/);
  assert.doesNotMatch(same.out, /new domain|domain removed/);

  // And a meaning change in the renamed file still needs its bump.
  const file = path.join(dir, "domains", "support.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace("      - Spam-classified requests\n", ""));
  const moved = cli(dir, "version-check", "--base", "HEAD");
  assert.equal(moved.status, 1, moved.out);
  assert.match(moved.stdout, /\[major\] OpenTicket: exclusions changed/);
});

// (B) never pass on something that could not be read

test("an unresolvable --base fails in one line", (t) => {
  const { dir } = scratchRepo(t);
  const r = cli(dir, "version-check", "--base", "no-such-revision");
  assert.equal(r.status, 1, r.out);
  assert.equal(r.out.trim().split("\n").length, 1, r.out);
  assert.match(r.stderr, /--base no-such-revision does not resolve to a commit/);
});

test("a --dir outside the git repository fails in one line", (t) => {
  const { dir } = scratchRepo(t);
  const outside = mkdtempSync(path.join(tmpdir(), "ontology-ops-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  cpSync(path.join(KIT, "domains"), outside, { recursive: true });
  for (const d of [outside, "../"]) {
    const r = cli(dir, "version-check", "--base", "HEAD", "--dir", d);
    assert.equal(r.status, 1, r.out);
    assert.equal(r.out.trim().split("\n").length, 1, r.out);
    assert.match(r.stderr, /is outside the git repository/);
  }
});

test("a current domain file that does not parse fails in one line", (t) => {
  const { dir } = scratchRepo(t);
  writeFileSync(path.join(dir, "domains", "support-domain.yaml"), "apiVersion: [unclosed\n");
  const r = cli(dir, "version-check", "--base", "HEAD");
  assert.equal(r.status, 1, r.out);
  assert.equal(r.out.trim().split("\n").length, 1, r.out);
  assert.match(r.stderr, /✗ domains\/support-domain\.yaml: does not parse/);
});

test("an absolute --dir inside the repository works as its relative form does", (t) => {
  const { dir } = scratchRepo(t);
  const file = path.join(dir, "domains", "support-domain.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace("      - Spam-classified requests\n", ""));
  const relative = cli(dir, "version-check", "--base", "HEAD", "--dir", "domains");
  const absolute = cli(dir, "version-check", "--base", "HEAD", "--dir", path.join(dir, "domains"));
  assert.equal(relative.status, 1, relative.out);
  assert.equal(absolute.status, relative.status);
  assert.equal(absolute.stdout, relative.stdout);
  assert.equal(absolute.stderr, relative.stderr);

  // And from a subdirectory, a relative --dir that climbs back is the same too.
  mkdirSync(path.join(dir, "sub"));
  const fromSub = cli(path.join(dir, "sub"), "version-check", "--base", "HEAD", "--dir", "../domains");
  assert.equal(fromSub.stdout, relative.stdout);
});

// (C) unknown keys, through the CLI, with file and place

test("validate reports an unknown top-level key with its file and place", (t) => {
  const { dir } = scratchRepo(t);
  const file = path.join(dir, "domains", "support-domain.yaml");
  writeFileSync(file, `${readFileSync(file, "utf8")}description: stray\n`);
  const r = cli(dir, "validate");
  assert.equal(r.status, 1, r.out);
  assert.match(r.stderr, /domains\/support-domain\.yaml\n {2}<file>: unknown field `description`/);
});

// (F) the glossary header names the directory it read

test("report writes the directory it read into the glossary header", (t) => {
  const { dir, git } = scratchRepo(t);
  git("mv", "domains", "definitions");
  const r = cli(dir, "report", "--dir", "definitions");
  assert.equal(r.status, 0, r.out);
  assert.match(r.stdout, /from `definitions\/`/);
  assert.doesNotMatch(r.stdout, /from `domains\/`/);
});
