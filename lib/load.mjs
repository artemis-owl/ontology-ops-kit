// Load OntologyDomain files from disk.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const DEFAULT_DOMAIN_DIR = "domains";

export async function listDomainFiles(dir = DEFAULT_DOMAIN_DIR) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

// Returns { file, doc, parseError }. A parse failure is data, not a throw, so the
// validator can report every bad file in one run instead of dying on the first.
export async function loadDomains(dir = DEFAULT_DOMAIN_DIR) {
  const files = await listDomainFiles(dir);
  const out = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8");
    out.push(parseDomain(raw, file));
  }
  return out;
}

export function parseDomain(raw, file = "<string>") {
  try {
    return { file, doc: parse(raw) ?? {}, parseError: null };
  } catch (err) {
    return { file, doc: null, parseError: err.message };
  }
}
