# Ontology Ops Kit

Most organizations put their business definitions in a wiki. The wiki is accurate
the day it is written, and its accuracy is never tested again — a fire
extinguisher with no inspection tag, mounted proudly in the hall.

This kit treats definitions like API contracts instead. Three legs, and the whole
value is in having all three:

| Leg | What it is | Here |
| --- | --- | --- |
| **Contract** | Definitions declared in versioned YAML | `domains/*.yaml` |
| **Enforcement** | CI fails when the contract is violated *or when meaning changes without a version bump* | `ontology-ops validate`, `ontology-ops version-check` |
| **Derivation** | The glossary people read is generated, never hand-kept | `ontology-ops report` → [`GLOSSARY.md`](GLOSSARY.md) |

Skip any leg and the vocabulary decays back into documentation.

## Quick start

```bash
git clone https://github.com/artemis-owl/ontology-ops-kit
cd ontology-ops-kit
npm install
npm run validate      # ✓ 2 domains, 5 terms — contract satisfied.
npm run report        # writes GLOSSARY.md
```

## Define a term

```yaml
apiVersion: semantics.artemis.owl/v1
kind: OntologyDomain
metadata:
  name: customer-domain
  version: 2.1.0
  owner: platform-billing-squad
terms:
  - name: ActiveCustomer
    summary: An identity that has completed a billable transaction in the last 30 days.
    # What a term excludes is usually where the arguments are.
    exclusions:
      - Trial Users
      - Paused Subscriptions
      - Internal Test Accounts
    aliases:
      - Billed User
    # Ground the definition in real infrastructure — enough to point a developer
    # or an agent at the system of record, not a full data dictionary.
    mappings:
      primarySource: postgres.billingdb.public.subscriptions
      statusColumn: billing_status='active'
```

The scope is deliberately small. This is not a tool for modeling the universe;
it is a tool for the twenty terms your teams already argue about.

## SemVer for meaning

The distinctive check. Every domain carries a version, and `version-check`
compares what you are about to merge against the released revision, classifies
what changed, and fails when the bump does not cover it.

```
✗ domains/customer-domain.yaml — declared a patch bump (2.1.0 -> 2.1.1) but changes require major
    [major] ActiveCustomer: exclusions changed (+Trial Users) — the boundary of the definition moved
```

That is the incident this kit exists to prevent. Someone decides `ActiveCustomer`
no longer includes trial users, every dashboard drops fifteen percent on Monday,
and three teams spend the morning proving their pipeline is fine.

What triggers which bump:

| Change | Bump | Why |
| --- | --- | --- |
| Term removed | **major** | Consumers referencing it break |
| `exclusions` changed | **major** | The boundary of the definition moved |
| `primarySource` / `statusColumn` changed | **major** | Different system of record, different rows |
| Alias removed | **major** | Lookups using it stop resolving |
| Term added, alias added | **minor** | Additive; nothing existing breaks |
| `summary` reworded | **patch** ⚠️ | See below |

**The honest limit:** whether a reworded summary moved the boundary is a judgment
a diff cannot make. Rewording is reported as `patch` with a warning that says so
out loud. A tool that guessed here would be wrong quietly, which is worse than
being limited loudly.

## Wire it into CI

Copy [`.github/workflows/ontology-ops.yml`](.github/workflows/ontology-ops.yml).
It validates the contract, checks version bumps against the PR base, runs the
tests, and fails if `GLOSSARY.md` is stale — that last step is what keeps the
derived document from drifting back into a hand-maintained one.

`version-check` needs history, so use `fetch-depth: 0` in the checkout step.

## Serve it to agents

An agent told to "clean up test accounts" will decide for itself what a test
account is unless something tells it. [`examples/mcp-server/`](examples/mcp-server/)
serves the validated definitions over the Model Context Protocol, so the
definitions an agent reads at runtime are the same ones CI enforced.

```bash
claude mcp add ontology -- node /absolute/path/to/ontology-ops-kit/examples/mcp-server/server.mjs
```

Unknown terms return a refusal listing what *is* defined, so the failure mode is
asking rather than inventing.

## Try the loop in five minutes

The fastest way to understand the kit is to break it on purpose:

1. Open `domains/customer-domain.yaml` and add `- Paused Subscriptions` to
   `ActiveCustomer`'s exclusions.
2. Run `npm run validate` — still passes. The file is well-formed; that is not
   the failure being caught.
3. Commit it, then run `npm run version-check`. It fails: you moved a boundary
   while the version says `2.1.0`.
4. Bump `version` to `3.0.0` and re-run. It passes, and the change is now
   labeled for everyone downstream.
5. Run `npm run report` and see `GLOSSARY.md` update itself.

Then do the same thing with a typo — rename `exclusions` to `exclusion` — and
watch `validate` catch it rather than silently ignoring a field it does not know.

## Commands

```
ontology-ops validate                    check every domain against the contract
ontology-ops version-check [--base rev]  check bumps cover the semantic changes
ontology-ops report [--write FILE]       derive the glossary
                    [--dir PATH]         domain directory (default: domains)
```

## Adopting it in a real repo

Copy `bin/`, `lib/`, and the workflow into your repository, point `--dir` at
wherever your definitions live, and delete the example domains. One dependency
([`yaml`](https://www.npmjs.com/package/yaml)), Node 20+.

Start with one field two systems currently disagree about — not the full
vocabulary. The smallest contract worth enforcing is the one that caused your
last confusing incident.

## Background

The argument behind this kit: [An Ontology You Don't Enforce Is a Wiki Page](https://artemisowl.io/research/an-ontology-you-dont-enforce-is-a-wiki-page/)
and [Semantics Belongs in the Runtime](https://artemisowl.io/research/semantics-belongs-in-the-runtime/)
from [Artemis Owl Systems](https://artemisowl.io).

Apache-2.0.
