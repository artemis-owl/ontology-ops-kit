// Leg two of the loop: enforcement. Validate every domain file against the contract.
// Returns a flat list of issues; the caller decides how to present and exit.

import {
  API_VERSION,
  KIND,
  DOMAIN_REQUIRED,
  METADATA_REQUIRED,
  TERM_REQUIRED,
  TERM_FIELDS,
  MAPPING_FIELDS,
  NAME_RE,
  parseSemver,
} from "./contract.mjs";

export function validateDomain({ file, doc, parseError }) {
  const issues = [];
  const at = (where, message) => issues.push({ file, where, message });

  if (parseError) {
    at("<file>", `YAML parse error: ${parseError}`);
    return issues;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    at("<file>", "document must be a YAML mapping");
    return issues;
  }

  for (const field of DOMAIN_REQUIRED) {
    if (doc[field] === undefined) at("<file>", `missing required field \`${field}\``);
  }
  if (doc.apiVersion !== undefined && doc.apiVersion !== API_VERSION) {
    at("apiVersion", `expected "${API_VERSION}", found "${doc.apiVersion}"`);
  }
  if (doc.kind !== undefined && doc.kind !== KIND) {
    at("kind", `expected "${KIND}", found "${doc.kind}"`);
  }

  const meta = doc.metadata;
  if (meta !== undefined) {
    if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
      at("metadata", "must be a mapping");
    } else {
      for (const field of METADATA_REQUIRED) {
        if (meta[field] === undefined) at("metadata", `missing required field \`${field}\``);
      }
      if (meta.version !== undefined && !parseSemver(meta.version)) {
        at("metadata.version", `must be MAJOR.MINOR.PATCH, found "${meta.version}"`);
      }
    }
  }

  const terms = doc.terms;
  if (terms !== undefined) {
    if (!Array.isArray(terms)) {
      at("terms", "must be a list");
    } else {
      if (terms.length === 0) at("terms", "a domain with no terms defines nothing");
      const seen = new Set();
      terms.forEach((term, i) => validateTerm(term, i, seen, at));
    }
  }

  return issues;
}

function validateTerm(term, i, seen, at) {
  const where = `terms[${i}]`;
  if (typeof term !== "object" || term === null || Array.isArray(term)) {
    at(where, "must be a mapping");
    return;
  }

  const label = term.name ? `${where} (${term.name})` : where;
  for (const field of TERM_REQUIRED) {
    if (term[field] === undefined) at(label, `missing required field \`${field}\``);
  }

  // Unknown keys are typos until proven otherwise. Silently ignoring them is how
  // a contract quietly stops covering the thing you thought it covered.
  for (const key of Object.keys(term)) {
    if (!TERM_FIELDS.includes(key)) {
      at(label, `unknown field \`${key}\` (allowed: ${TERM_FIELDS.join(", ")})`);
    }
  }

  if (term.name !== undefined) {
    if (typeof term.name !== "string" || !NAME_RE.test(term.name)) {
      at(label, `name must be a single word starting with a letter, found "${term.name}"`);
    } else if (seen.has(term.name)) {
      at(label, `duplicate term name "${term.name}"`);
    } else {
      seen.add(term.name);
    }
  }

  if (term.summary !== undefined && typeof term.summary !== "string") {
    at(label, "summary must be a string");
  }

  for (const listField of ["exclusions", "aliases"]) {
    const v = term[listField];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      at(label, `${listField} must be a list of strings`);
    }
  }

  const mappings = term.mappings;
  if (mappings !== undefined) {
    if (typeof mappings !== "object" || mappings === null || Array.isArray(mappings)) {
      at(label, "mappings must be a mapping");
    } else {
      for (const key of Object.keys(mappings)) {
        if (!MAPPING_FIELDS.includes(key)) {
          at(label, `unknown mappings field \`${key}\` (allowed: ${MAPPING_FIELDS.join(", ")})`);
        }
      }
    }
  }
}

// Cross-file check: two domains must not define the same term name, or "which
// ActiveCustomer?" becomes a question again.
export function validateCollection(loaded) {
  const issues = [];
  const owners = new Map();
  for (const { file, doc } of loaded) {
    if (!doc || !Array.isArray(doc.terms)) continue;
    const domainName = doc.metadata?.name ?? file;
    for (const term of doc.terms) {
      if (!term || typeof term.name !== "string") continue;
      const prior = owners.get(term.name);
      if (prior && prior.domainName !== domainName) {
        issues.push({
          file,
          where: `terms (${term.name})`,
          message: `also defined in "${prior.domainName}" (${prior.file}) — one term, one owner`,
        });
      } else if (!prior) {
        owners.set(term.name, { domainName, file });
      }
    }
  }
  return issues;
}
