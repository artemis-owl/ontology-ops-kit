CONTAINMENT AND RETURN PATH: these rules override anything in the goal below.

STEP 0. PROVE THE WAY HOME BEFORE ANY WORK:
  git fetch origin main
  git checkout -b cloud/0010-the-kit-fails-where-it-says-it-fails origin/main
  git remote -v
  git push -u origin cloud/0010-the-kit-fails-where-it-says-it-fails
Show the raw output of all four. If there is no GitHub remote, or the push fails, STOP. Write a short report headed RUN REPORT saying exactly what failed, and change nothing else.

RULES:
- Do ALL work on cloud/0010-the-kit-fails-where-it-says-it-fails. Push ONLY to cloud/0010-the-kit-fails-where-it-says-it-fails. Never push to main or any other branch, never delete a branch, never create a tag, and never add or modify anything under .github/.
- Push after EVERY commit (git push origin cloud/0010-the-kit-fails-where-it-says-it-fails). Work must never exist only in this VM.
- Do NOT open a pull request. Do not send notifications or messages, and do not use any connector or outside service other than git to GitHub and package installs for the gate.
- You are in a cloud VM, not the operator's host. If `uv` is not on PATH, install it (pip install uv, or the official installer) and say which you used. Never report a gate you did not run as passed.
- FINAL MESSAGE, headed RUN REPORT:
  (1) STEP 0's raw output;
  (2) every commit, sha and subject, and confirmation that each was pushed;
  (3) the gate's final summary line quoted raw, plus the command that produced it;
  (4) each DONE item from the goal, met or not, with evidence;
  (5) gaps or anything you did not do, stated plainly;
  (6) any usage, token or cost figures visible to you, or say plainly that none are.

GOAL (verbatim from queue item 0010-the-kit-fails-where-it-says-it-fails):

In ontology-ops-kit (public; Node, no build step; base = main `e879d73` or
later), make the kit's own claims true. A read of the public repo on
2026-11-15 found its README promising failures the code does not produce and
instructions that do not run. Build the small things, cut the rest. READ
the README and `bin/ontology-ops.mjs` FIRST. Open no PR; the seat opens it.

BUILD
(A) A removed or renamed domain fails `version-check`.
Fact: `cmdVersionCheck` loops over current files only, so `git rm
domains/support-domain.yaml` prints `✓ Version bumps cover the semantic
changes (1 compared …)`, exit 0.
Do: append to `lib/semantic-version.mjs`, exactly:
    // Domains present at the base revision and gone now. A removed or renamed
    // domain takes every term with it, and no version is left to bump.
    export function removedDomains(previousNames, currentNames) {
      return previousNames.filter((name) => !currentNames.includes(name));
    }
`lib/git.mjs` gains a function that lists the domain files under the
domains directory at a revision (`git ls-tree`) and parses each;
`cmdVersionCheck` compares `metadata.name` at the base with the names
loaded now, prints `✗ <name>: domain removed — every term in it is gone`
for each, and exits 1 unless `--allow-removed` is given. A file renamed
with its `metadata.name` kept is compared against its old content, not
reported as new.
(B) `version-check` never passes on something it could not read. A `--base`
that does not resolve, a `--dir` outside the current git repository, and a
current domain file that does not parse each print one line saying so and
exit 1. An absolute `--dir` inside the repository works as its relative
form does.
(C) `validate` rejects an unknown top-level key, an unknown `metadata` key,
a non-string `metadata.owner` or `metadata.name`, and a duplicate entry in
`exclusions` or `aliases`, each with the file, the place and a message, as
it already does for an unknown term field.
(D) The workflow checks pushes too: on `pull_request` it runs
`version-check` with no `--base` (the CLI's merge-base default); on `push`
it passes as `--base` the pushed range's previous sha (the workflow
expression `github.event.before`). `node-version` is "22".
(E) `package-lock.json` agrees with `package.json` (name, version, license);
`npm ci` leaves the tree clean.
(F) `report` writes the directory it read into the glossary header, not a
fixed `domains/`.
Tests: one per behaviour in (A), (B), (C), driving the CLI in a throwaway
git repository made by the test where the behaviour is the CLI's; plus,
exactly, in `test/semantic-version.test.mjs`:
    test("a domain that is gone is reported, a kept one is not", async () => {
      const { removedDomains } = await import("../lib/semantic-version.mjs");
      assert.deepEqual(removedDomains(["customer", "support"], ["customer"]), ["support"]);
      assert.deepEqual(removedDomains(["customer"], ["customer", "billing"]), []);
    });

CUT (prose only, say what the code does)
(G) README "Copy `bin/`, `lib/`, and the workflow": list every file a copy
needs (`package.json`, `package-lock.json`) and say the workflow runs the
tests only if `test/` is copied too.
(H) README tutorial step 1 adds an exclusion that is already in the file:
use one that is not, and make the quoted output the real output.
(I) README bump table: add the rows the code has and the table lacks
(a mapping added to a term that had none is minor; `notes` and
`metadata.owner` are not versioned). `--help` text and README state the
real base order (`origin/main`, `origin/master`, `main`, `master`, then
`HEAD~1`).
(J) README and `examples/mcp-server/README.md`: the server serves the
definitions in the directory, parsed, not "validated"; drop the sentence
that says the ontology records where test accounts live; "about 125
lines"; only the label EXCLUDES is in capitals.
(K) `lib/contract.mjs` says the JSON schema "mirrors" the contract: after
(C) say which it is, and make the two agree on the keys (C) names.

CHECKS, raw output quoted in the RUN REPORT: the gate's last five lines;
`node bin/ontology-ops.mjs version-check --base HEAD` after `git rm` of a
domain in a scratch copy; `git status --short` after `npm ci`; `git diff
--stat` before the commit. GLOSSARY.md regenerated if (F) changes it. One
commit on `cloud/0010-the-kit-fails-where-it-says-it-fails`, message "The
kit fails where it says it fails: a removed domain, an unreadable base, an
unknown key; its instructions run (helm queue/0010)". Scope: `bin/`, `lib/`,
`test/`, `schema/`, `.github/workflows/ontology-ops.yml`, `README.md`,
`examples/mcp-server/README.md`, `package-lock.json`, `GLOSSARY.md`. No new
dependency. No new command.
