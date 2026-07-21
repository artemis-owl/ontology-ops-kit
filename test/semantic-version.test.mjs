import { test } from "node:test";
import assert from "node:assert/strict";
import { diffDomains, checkVersionBump } from "../lib/semantic-version.mjs";

const domain = (version, terms) => ({
  apiVersion: "semantics.artemis.owl/v1",
  kind: "OntologyDomain",
  metadata: { name: "d", version, owner: "team" },
  terms,
});

const active = (over = {}) => ({
  name: "ActiveCustomer",
  summary: "Billed in the last 30 days.",
  exclusions: ["Trial Users"],
  aliases: ["Billed User"],
  mappings: { primarySource: "postgres.billingdb.public.subscriptions", statusColumn: "billing_status='active'" },
  ...over,
});

test("no changes require no bump", () => {
  const d = diffDomains(domain("1.0.0", [active()]), domain("1.0.0", [active()]));
  assert.equal(d.changes.length, 0);
  assert.equal(d.requiredName, "none");
});

test("adding a term is minor", () => {
  const before = domain("1.0.0", [active()]);
  const after = domain("1.1.0", [active(), { name: "TrialUser", summary: "Never billed." }]);
  assert.equal(diffDomains(before, after).requiredName, "minor");
  assert.equal(checkVersionBump(before, after).ok, true);
});

test("removing a term is major", () => {
  const before = domain("1.0.0", [active(), { name: "TrialUser", summary: "Never billed." }]);
  const after = domain("1.1.0", [active()]);
  const result = checkVersionBump(before, after);
  assert.equal(result.requiredName, "major");
  assert.equal(result.ok, false, "a minor bump must not cover a term removal");
});

test("changing exclusions is major — the boundary moved", () => {
  const before = domain("2.0.0", [active()]);
  const after = domain("2.0.1", [active({ exclusions: ["Trial Users", "Paused Subscriptions"] })]);
  const result = checkVersionBump(before, after);
  assert.equal(result.requiredName, "major");
  assert.equal(result.ok, false);
  assert.match(result.changes[0].message, /boundary of the definition moved/);
});

test("major bump covers an exclusion change", () => {
  const before = domain("2.0.0", [active()]);
  const after = domain("3.0.0", [active({ exclusions: [] })]);
  assert.equal(checkVersionBump(before, after).ok, true);
});

test("changing the system of record is major", () => {
  const before = domain("1.0.0", [active()]);
  const after = domain("1.0.1", [
    active({ mappings: { primarySource: "snowflake.analytics.customers", statusColumn: "billing_status='active'" } }),
  ]);
  const result = checkVersionBump(before, after);
  assert.equal(result.requiredName, "major");
  assert.equal(result.ok, false);
});

test("adding an alias is minor, removing one is major", () => {
  const base = domain("1.0.0", [active()]);
  const added = domain("1.1.0", [active({ aliases: ["Billed User", "Current Subscriber"] })]);
  assert.equal(diffDomains(base, added).requiredName, "minor");

  const removed = domain("1.1.0", [active({ aliases: [] })]);
  assert.equal(diffDomains(base, removed).requiredName, "major");
});

test("reworded summary is patch, and says the tool cannot judge intent", () => {
  const before = domain("1.0.0", [active()]);
  const after = domain("1.0.1", [active({ summary: "Billed within the past 30 days." })]);
  const result = checkVersionBump(before, after);
  assert.equal(result.requiredName, "patch");
  assert.equal(result.ok, true);
  assert.match(result.changes[0].message, /only you can tell/);
});

test("a change with no version increase fails", () => {
  const before = domain("1.0.0", [active()]);
  const after = domain("1.0.0", [active(), { name: "New", summary: "x" }]);
  const result = checkVersionBump(before, after);
  assert.equal(result.ok, false);
  assert.match(result.reason, /did not increase/);
});

test("the worked example: dropping trial users from ActiveCustomer", () => {
  // The brochure's scenario — dashboards drop 15% and this is why.
  const before = domain("2.1.0", [active({ exclusions: [] })]);
  const after = domain("2.2.0", [active({ exclusions: ["Trial Users"] })]);
  const result = checkVersionBump(before, after);
  assert.equal(result.ok, false);
  assert.equal(result.requiredName, "major");
});
