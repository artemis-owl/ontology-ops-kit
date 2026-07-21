#!/usr/bin/env node
// ontology-ops — the three legs of the loop as three subcommands.
//
//   validate       every domain file conforms to the contract
//   version-check  changes since a base revision carry the right SemVer bump
//   report         derive the glossary from the domain files

import { writeFile } from "node:fs/promises";
import process from "node:process";
import { loadDomains, DEFAULT_DOMAIN_DIR } from "../lib/load.mjs";
import { validateDomain, validateCollection } from "../lib/validate.mjs";
import { checkVersionBump } from "../lib/semantic-version.mjs";
import { domainAtRev, resolveBaseRev } from "../lib/git.mjs";
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
                           (default: merge-base with origin/main, else HEAD~1)
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
  const base = await resolveBaseRev(typeof flag("base") === "string" ? flag("base") : null);
  if (!base) {
    console.log("No base revision to compare against (shallow clone or first commit) — skipping.");
    return;
  }

  const loaded = await loadDomains(dir);
  let failures = 0;
  let compared = 0;

  for (const current of loaded) {
    if (!current.doc) continue;
    const previous = await domainAtRev(current.file, base);
    if (!previous?.doc) {
      console.log(`+ ${current.file}: new domain, nothing to compare.`);
      continue;
    }
    compared++;

    const result = checkVersionBump(previous.doc, current.doc);
    if (result.changes.length === 0) {
      console.log(`= ${current.file}: unchanged.`);
      continue;
    }

    const mark = result.ok ? "✓" : "✗";
    console.log(`\n${mark} ${current.file} — ${result.reason}`);
    for (const change of result.changes) {
      console.log(`    [${change.level}] ${change.term}: ${change.message}`);
    }
    if (!result.ok) failures++;
  }

  console.log("");
  if (failures) {
    console.error(
      `✗ ${failures} domain${failures === 1 ? "" : "s"} changed meaning without an adequate version bump (base: ${base.slice(0, 8)}).`,
    );
    process.exit(1);
  }
  console.log(`✓ Version bumps cover the semantic changes (${compared} compared, base: ${base.slice(0, 8)}).`);
}

async function cmdReport() {
  const loaded = await loadDomains(dir);
  const markdown = renderGlossary(loaded);
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
