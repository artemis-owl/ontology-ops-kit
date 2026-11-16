import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDomain } from "../lib/load.mjs";
import { validateDomain, validateCollection } from "../lib/validate.mjs";

const check = (yaml) => validateDomain(parseDomain(yaml, "test.yaml"));
const messages = (issues) => issues.map((i) => i.message).join(" | ");

const VALID = `
apiVersion: semantics.artemis.owl/v1
kind: OntologyDomain
metadata:
  name: d
  version: 1.0.0
  owner: team
terms:
  - name: ActiveCustomer
    summary: Billed in the last 30 days.
`;

test("a well-formed domain passes", () => {
  assert.deepEqual(check(VALID), []);
});

test("missing required metadata is reported", () => {
  const issues = check(VALID.replace("  owner: team\n", ""));
  assert.match(messages(issues), /missing required field `owner`/);
});

test("a malformed version is reported", () => {
  const issues = check(VALID.replace("1.0.0", "v2"));
  assert.match(messages(issues), /MAJOR\.MINOR\.PATCH/);
});

test("the wrong apiVersion is reported", () => {
  const issues = check(VALID.replace("semantics.artemis.owl/v1", "example.com/v1"));
  assert.match(messages(issues), /expected "semantics\.artemis\.owl\/v1"/);
});

test("an unknown term field is a typo, not a silent extra", () => {
  const issues = check(`${VALID}    exclusion: [Trial Users]\n`);
  assert.match(messages(issues), /unknown field `exclusion`/);
});

test("duplicate term names are reported", () => {
  const issues = check(`${VALID}  - name: ActiveCustomer\n    summary: Again.\n`);
  assert.match(messages(issues), /duplicate term name/);
});

test("exclusions must be a list of strings", () => {
  const issues = check(`${VALID}    exclusions: Trial Users\n`);
  assert.match(messages(issues), /exclusions must be a list of strings/);
});

test("a parse error is reported as an issue, not thrown", () => {
  const issues = check("apiVersion: [unclosed\n");
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /YAML parse error/);
});

test("the same term defined in two domains is reported", () => {
  const a = parseDomain(VALID, "a.yaml");
  const b = parseDomain(VALID.replace("name: d", "name: other"), "b.yaml");
  const issues = validateCollection([a, b]);
  assert.match(messages(issues), /one term, one owner/);
});

test("an unknown top-level key is a typo, not a silent extra", () => {
  const issues = check(`${VALID}description: stray\n`);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].file, "test.yaml");
  assert.equal(issues[0].where, "<file>");
  assert.match(issues[0].message, /unknown field `description`/);
});

test("an unknown metadata key is a typo, not a silent extra", () => {
  const issues = check(VALID.replace("  owner: team\n", "  owner: team\n  ownr: team\n"));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].where, "metadata");
  assert.match(issues[0].message, /unknown field `ownr`/);
});

test("metadata.owner and metadata.name must be strings", () => {
  const owner = check(VALID.replace("owner: team", "owner: [a, b]"));
  assert.equal(owner.length, 1);
  assert.equal(owner[0].where, "metadata.owner");
  assert.match(owner[0].message, /must be a string/);

  const name = check(VALID.replace("name: d", "name: 42"));
  assert.equal(name.length, 1);
  assert.equal(name[0].where, "metadata.name");
  assert.match(name[0].message, /must be a string/);
});

test("a duplicate entry in exclusions or aliases is reported", () => {
  const excl = check(`${VALID}    exclusions: [Trial Users, Trial Users]\n`);
  assert.equal(excl.length, 1);
  assert.equal(excl[0].where, "terms[0] (ActiveCustomer)");
  assert.match(excl[0].message, /duplicate entry "Trial Users" in exclusions/);

  const alias = check(`${VALID}    aliases: [Billed User, Billed User]\n`);
  assert.equal(alias.length, 1);
  assert.match(alias[0].message, /duplicate entry "Billed User" in aliases/);
});

test("the JSON schema allows exactly the keys the contract allows", async () => {
  const { readFile } = await import("node:fs/promises");
  const contract = await import("../lib/contract.mjs");
  const schema = JSON.parse(await readFile(new URL("../schema/ontology-domain.schema.json", import.meta.url), "utf8"));
  const keys = (o) => Object.keys(o.properties).sort();
  const term = schema.properties.terms.items;

  assert.deepEqual(keys(schema), [...contract.DOMAIN_FIELDS].sort());
  assert.deepEqual(keys(schema.properties.metadata), [...contract.METADATA_FIELDS].sort());
  assert.deepEqual(keys(term), [...contract.TERM_FIELDS].sort());
  assert.deepEqual(keys(term.properties.mappings), [...contract.MAPPING_FIELDS].sort());
  for (const o of [schema, schema.properties.metadata, term, term.properties.mappings]) {
    assert.equal(o.additionalProperties, false);
  }
  assert.deepEqual([...schema.required].sort(), [...contract.DOMAIN_REQUIRED].sort());
  assert.deepEqual([...schema.properties.metadata.required].sort(), [...contract.METADATA_REQUIRED].sort());
  assert.equal(schema.properties.metadata.properties.name.type, "string");
  assert.equal(schema.properties.metadata.properties.owner.type, "string");
  assert.equal(term.properties.exclusions.uniqueItems, true);
  assert.equal(term.properties.aliases.uniqueItems, true);
});
