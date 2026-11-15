// The contract: what an OntologyDomain file must contain to be valid.
//
// This is the single source of truth for validation; it is what CI enforces.
// `schema/ontology-domain.schema.json` is a subset of it for editor autocomplete:
// the two agree on every allowed key (top level, metadata, term, mappings), on the
// required ones, on which fields must be strings, and on unique `exclusions` and
// `aliases` entries — test/validate.test.mjs checks the keys. The schema cannot
// express the rest: duplicate term names within a file, and one term defined in
// two domains.

export const API_VERSION = "semantics.artemis.owl/v1";
export const KIND = "OntologyDomain";

export const DOMAIN_REQUIRED = ["apiVersion", "kind", "metadata", "terms"];
// No optional top-level or metadata keys: anything else is a typo, as for terms.
export const DOMAIN_FIELDS = [...DOMAIN_REQUIRED];
export const METADATA_REQUIRED = ["name", "version", "owner"];
export const METADATA_FIELDS = [...METADATA_REQUIRED];
export const TERM_REQUIRED = ["name", "summary"];

// Optional term fields, declared so typos are caught rather than silently ignored.
export const TERM_OPTIONAL = ["exclusions", "aliases", "mappings", "notes"];
export const TERM_FIELDS = [...TERM_REQUIRED, ...TERM_OPTIONAL];

export const MAPPING_FIELDS = ["primarySource", "statusColumn", "notes"];

// Fields whose change alters what the term *includes* — the boundary of the
// definition. Changing any of these is a breaking (major) change, because
// downstream counts, dashboards, and agent behavior move when they move.
export const BOUNDARY_TERM_FIELDS = ["exclusions"];
export const BOUNDARY_MAPPING_FIELDS = ["primarySource", "statusColumn"];

export const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
export const NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/; // term names: PascalCase-ish, no spaces

export function parseSemver(version) {
  const m = String(version).match(SEMVER_RE);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

export function compareSemver(a, b) {
  for (const k of ["major", "minor", "patch"]) {
    if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  }
  return 0;
}
