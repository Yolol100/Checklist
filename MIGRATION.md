# Checklist → Designchecker migration status

## Status

This repository remains the active legacy Website QA evidence runner until `Yolol100/Designchecker` proves full formal-evidence parity. It is maintenance-only for the Webactueel platform: preserve existing contracts and security, but add new generic browser/visual capabilities to Designchecker instead.

## What must remain stable

- immutable request-file handling;
- public-target and SSRF protection;
- GET/HEAD-only browser networking;
- privacy redaction and bounded artifacts;
- raw evidence validation;
- policy evaluation across one or more raw rounds;
- Evidence Manifest and Runtime Matrix semantics;
- severity, finding status, rollback, monitoring and release-decision validation;
- exact request/head-SHA/run/result correlation;
- Website QA ownership of severity, hertest and Go/No-Go.

## Allowed changes

- security and compatibility fixes;
- fixes for existing evidence contracts;
- parity fixtures and tests;
- documentation or minimal extraction needed for Designchecker migration.

## Not allowed

- new independent platform capabilities that belong in Designchecker;
- weaker privacy or network guards;
- project/customer truth on `main`;
- a repository-owned Go/No-Go decision;
- archive or adapter removal before parity and rollback proof.

## Exit gates

This repository may be retired only after:

1. the frozen Checklist parityset passes in Designchecker;
2. formal evidence finalization is semantically equivalent;
3. request/run/artifact correlation is verified;
4. Website QA accepts the replacement output;
5. the central adapterregistry is switched;
6. a stable regression period completes;
7. this repository remains available as rollback during that period.

Until all gates are green, `NO_CHANGE` is correct and this runtime remains active.
