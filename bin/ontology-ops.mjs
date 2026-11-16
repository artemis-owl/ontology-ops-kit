#!/usr/bin/env node
// ontology-ops — the three legs of the loop as three subcommands.
//
//   validate       every domain file conforms to the contract
//   version-check  changes since a base revision carry the right SemVer bump
//   report         derive the glossary from the domain files

import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadDomains, DEFAULT_DOMAIN_DIR } from "../lib/load.mjs";
import { validateDomain, validateCollection } from "../lib/validate.mjs";
import { checkVersionBump, removedDomains } from "../lib/semantic-version.mjs";
import { domainsAtRev, repoRelativeDir, repoRoot, resolveBaseRev } from "../lib/git.mjs";
import { renderGlossary, coverage } from "../lib/report.mjs";

const argv = process.argv.slice(2);
const command = argv[0];
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : (argv[i + 1] ?? true);
};
const dir = flag("dir") || DEFAULT_DOMAIN_DIR;

const USAGE = `ontology-ops <command> [options]

Commands:
  validate                 check every domain file against the contract
  version-check            check that semantic changes carry the right SemVer bump
  report                   print the derived glossary

Options:
  --dir <path>             domain directory (default: ${DEFAULT_DOMAIN_DIR})
  --base <rev>             version-check: revision to compare against
                           (default: merge-base of HEAD with the first of
                           origin/main, origin/master, main, master that
                           exists; else HEAD~1)
  --allow-removed          version-check: report removed domains without failing
  --write <file>           report: write the glossary to a file
`;

switch (command) {
  case "validate":
    await cmdValidate();
    break;
  case "version-check":
    await cmdVersionCheck();
    break;
  case "report":
    await cmdReport();
    break;
  default:
    console.log(USAGE);
    process.exit(command ? 1 : 0);
}

async function cmdValidate() {
  const loaded = await loadDomains(dir);
  if (loaded.length === 0) {
    console.error(`No domain files found in ${dir}/`);
    process.exit(1);
  }

  const issues = [...loaded.flatMap(validateDomain), ...validateCollection(loaded)];

  if (issues.length === 0) {
    const terms = loaded.reduce((n, d) => n + (d.doc?.terms?.length ?? 0), 0);
    console.log(`✓ ${loaded.length} domains, ${terms} terms — contract satisfied.`);
    return;
  }

  let currentFile = null;
  for (const issue of issues) {
    if (issue.file !== currentFile) {
      currentFile = issue.file;
      console.error(`\n${currentFile}`);
    }
    console.error(`  ${issue.where}: ${issue.message}`);
  }
  console.error(`\n✗ ${issues.length} problem${issues.length === 1 ? "" : "s"} in ${loaded.length} domain files.`);
  process.exit(1);
}

async function cmdVersionCheck() {
  // Never pass on something that could not be read: each of these is one line
  // and exit 1, not a quiet "nothing to compare".
  const fail = (line) => {
    console.error(`✗ ${line}`);
    process.exit(1);
  };

  const root = await repoRoot();
  if (!root) fail(`${process.cwd()} is not inside a git repository — nothing to compare against.`);

  const dirRel = await repoRelativeDir(root, dir);
  if (!dirRel) fail(`--dir ${dir} is outside the git repository at ${root}.`);

  const explicitBase = typeof flag("base") === "string" ? flag("base") : null;
  const base = await resolveBaseRev(explicitBase, root);
  if (!base) {
    if (explicitBase) fail(`--base ${explicitBase} does not resolve to a commit.`);
    console.log("No base revision to compare against (shallow clone or first commit) — skipping.");
    return;
  }
  const short = base.slice(0, 8);

  // Current files from the working tree, previous files from the base revision;
  // both named by repository-relative path, so an absolute --dir prints the same.
  const loaded = (await loadDomains(path.join(root, dirRel))).map((d) => ({
    ...d,
    file: path.relative(root, d.file).split(path.sep).join("/"),
  }));
  const previous = await domainsAtRev(dirRel, base, root);

  if (loaded.length === 0 && previous.length === 0) {
    fail(`No domain files in ${dirRel}/ now or at base ${short} — nothing was compared.`);
  }

  const unreadable = loaded.filter((d) => !d.doc || d.parseError);
  if (unreadable.length) {
    for (const d of unreadable) console.error(`✗ ${d.file}: does not parse — ${firstLine(d.parseError)}`);
    process.exit(1);
  }

  // Domains are matched by metadata.name, so a file renamed with its name kept
  // is compared against its old content; a name that is gone is a removal.
  const nameOf = (d) => (typeof d.doc?.metadata?.name === "string" ? d.doc.metadata.name : d.file);
  const previousByName = new Map();
  for (const d of previous) {
    if (!d.doc || d.parseError) {
      console.log(`! ${short}:${d.file}: does not parse at the base revision — not compared.`);
      continue;
    }
    if (!previousByName.has(nameOf(d))) previousByName.set(nameOf(d), d);
  }

  let failures = 0;
  let compared = 0;

  for (const current of loaded) {
    const before = previousByName.get(nameOf(current));
    if (!before) {
      console.log(`+ ${current.file}: new domain, nothing to compare.`);
      continue;
    }
    compared++;
    const renamed = before.file !== current.file ? ` (was ${before.file})` : "";

    const result = checkVersionBump(before.doc, current.doc);
    if (result.changes.length === 0) {
      console.log(`= ${current.file}${renamed}: unchanged.`);
      continue;
    }

    const mark = result.ok ? "✓" : "✗";
    console.log(`\n${mark} ${current.file}${renamed} — ${result.reason}`);
    for (const change of result.changes) {
      console.log(`    [${change.level}] ${change.term}: ${change.message}`);
    }
    if (!result.ok) failures++;
  }

  const removed = removedDomains([...previousByName.keys()], loaded.map(nameOf));
  const allowRemoved = argv.includes("--allow-removed");
  if (removed.length) console.log("");
  for (const name of removed) console.error(`✗ ${name}: domain removed — every term in it is gone`);
  if (removed.length && allowRemoved) {
    console.log(`  (${removed.length} removal${removed.length === 1 ? "" : "s"} accepted by --allow-removed)`);
  }

  console.log("");
  if (failures || (removed.length && !allowRemoved)) {
    if (failures) {
      console.error(
        `✗ ${failures} domain${failures === 1 ? "" : "s"} changed meaning without an adequate version bump (base: ${short}).`,
      );
    }
    if (removed.length && !allowRemoved) {
      console.error(
        `✗ ${removed.length} domain${removed.length === 1 ? "" : "s"} removed since base ${short}; pass --allow-removed if that is intended.`,
      );
    }
    process.exit(1);
  }
  console.log(`✓ Version bumps cover the semantic changes (${compared} compared, base: ${short}).`);
}

function firstLine(s) {
  return String(s ?? "unknown error").split("\n")[0];
}

async function cmdReport() {
  const loaded = await loadDomains(dir);
  const markdown = renderGlossary(loaded, { sourceDir: dir });
  const target = flag("write");

  if (typeof target === "string") {
    await writeFile(target, markdown);
    console.log(`Wrote ${target}`);
  } else {
    process.stdout.write(markdown);
  }

  const rows = coverage(loaded);
  if (rows.length) {
    console.log("");
    console.log("Domain              Ver      Terms  Grounded  Bounded");
    for (const r of rows) {
      console.log(
        `${r.domain.padEnd(20)}${String(r.version).padEnd(9)}${String(r.terms).padEnd(7)}${String(r.grounded).padEnd(10)}${r.bounded}`,
      );
    }
    console.log("");
    console.log("Grounded = has a system of record. Bounded = declares what it excludes.");
  }
}
