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
