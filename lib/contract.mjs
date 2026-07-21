// The contract: what an OntologyDomain file must contain to be valid.
//
// This is the single source of truth for validation. `schema/ontology-domain.schema.json`
// mirrors it for editor autocomplete; this file is what CI actually enforces, because
// purpose-built checks give better error messages than a generic schema validator.

export const API_VERSION = "semantics.artemis.owl/v1";
export const KIND = "OntologyDomain";

export const DOMAIN_REQUIRED = ["apiVersion", "kind", "metadata", "terms"];
export const METADATA_REQUIRED = ["name", "version", "owner"];
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
