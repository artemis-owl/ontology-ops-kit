// The distinctive check: SemVer applied to *meaning*.
//
// Structural diff between two revisions of a domain, classified into the bump the
// change requires. A definition whose boundary moved without a major bump is the
// failure this kit exists to catch — dashboards drop 15% and nobody was warned.
//
// Deliberate limit: whether a reworded `summary` moved the boundary is a judgment
// a diff cannot make. Wording changes are reported as `patch` with a warning that
// says so out loud, rather than being guessed at.

import { BOUNDARY_TERM_FIELDS, BOUNDARY_MAPPING_FIELDS, parseSemver, compareSemver } from "./contract.mjs";

export const BUMP = { none: 0, patch: 1, minor: 2, major: 3 };
export const BUMP_NAME = ["none", "patch", "minor", "major"];

const termIndex = (doc) => {
  const map = new Map();
  for (const t of doc?.terms ?? []) if (t?.name) map.set(t.name, t);
  return map;
};

const listOf = (v) => (Array.isArray(v) ? v.map(String) : []);
const setEq = (a, b) => a.length === b.length && new Set([...a, ...b]).size === a.length;

// Pure function: (previous doc, current doc) -> { required, changes[] }
export function diffDomains(before, after) {
  const changes = [];
  const add = (level, term, message) => changes.push({ level, term, message });

  const prev = termIndex(before);
  const next = termIndex(after);

  for (const [name, oldTerm] of prev) {
    const newTerm = next.get(name);

    if (!newTerm) {
      add("major", name, "term removed — consumers referencing it break");
      continue;
    }

    for (const field of BOUNDARY_TERM_FIELDS) {
      const a = listOf(oldTerm[field]);
      const b = listOf(newTerm[field]);
      if (!setEq(a, b)) {
        const added = b.filter((x) => !a.includes(x));
        const removed = a.filter((x) => !b.includes(x));
        const detail = [
          added.length ? `+${added.join(", ")}` : null,
          removed.length ? `-${removed.join(", ")}` : null,
        ]
          .filter(Boolean)
          .join(" ");
        add("major", name, `${field} changed (${detail}) — the boundary of the definition moved`);
      }
    }

    const oldAliases = listOf(oldTerm.aliases);
    const newAliases = listOf(newTerm.aliases);
    const droppedAliases = oldAliases.filter((x) => !newAliases.includes(x));
    const addedAliases = newAliases.filter((x) => !oldAliases.includes(x));
    if (droppedAliases.length) {
      add("major", name, `alias removed (${droppedAliases.join(", ")}) — lookups using it stop resolving`);
    }
    if (addedAliases.length) {
      add("minor", name, `alias added (${addedAliases.join(", ")})`);
    }

    const oldMap = oldTerm.mappings ?? {};
    const newMap = newTerm.mappings ?? {};
    for (const field of BOUNDARY_MAPPING_FIELDS) {
      const a = oldMap[field];
      const b = newMap[field];
      if (a === b) continue;
      if (a === undefined) add("minor", name, `mappings.${field} added`);
      else if (b === undefined) add("major", name, `mappings.${field} removed — the term lost its system of record`);
      else add("major", name, `mappings.${field} changed ("${a}" -> "${b}") — different system of record`);
    }

    if (oldTerm.summary !== newTerm.summary) {
      add(
        "patch",
        name,
        "summary reworded — patch if this only clarified wording, MAJOR if it moved the boundary (only you can tell)",
      );
    }
  }

  for (const name of next.keys()) {
    if (!prev.has(name)) add("minor", name, "term added");
  }

  const required = changes.reduce((max, c) => Math.max(max, BUMP[c.level]), BUMP.none);
  return { required, requiredName: BUMP_NAME[required], changes };
}

// Was the declared version bumped enough for the changes made?
export function checkVersionBump(before, after) {
  const diff = diffDomains(before, after);
  const oldV = parseSemver(before?.metadata?.version);
  const newV = parseSemver(after?.metadata?.version);

  if (!oldV || !newV) {
    return { ...diff, ok: false, reason: "version missing or malformed on one side of the comparison" };
  }

  const actual = actualBump(oldV, newV);
  if (diff.required === BUMP.none) {
    return { ...diff, ok: true, actualName: BUMP_NAME[actual], reason: "no semantic change detected" };
  }
  if (compareSemver(newV, oldV) <= 0) {
    return {
      ...diff,
      ok: false,
      actualName: BUMP_NAME[actual],
      reason: `version did not increase (${fmt(oldV)} -> ${fmt(newV)}) but changes require a ${diff.requiredName} bump`,
    };
  }
  if (actual < diff.required) {
    return {
      ...diff,
      ok: false,
      actualName: BUMP_NAME[actual],
      reason: `declared a ${BUMP_NAME[actual]} bump (${fmt(oldV)} -> ${fmt(newV)}) but changes require ${diff.requiredName}`,
    };
  }
  return { ...diff, ok: true, actualName: BUMP_NAME[actual], reason: `${BUMP_NAME[actual]} bump covers the changes` };
}

function actualBump(a, b) {
  if (b.major > a.major) return BUMP.major;
  if (b.major === a.major && b.minor > a.minor) return BUMP.minor;
  if (b.major === a.major && b.minor === a.minor && b.patch > a.patch) return BUMP.patch;
  return BUMP.none;
}

const fmt = (v) => `${v.major}.${v.minor}.${v.patch}`;
