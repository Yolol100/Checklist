# Checklist → Designchecker migration status

## Status

The formal-evidence parity migration is complete and the `website-qa-checklist` owner accepted the controlled-runtime evidence route on 2026-09-15. `Yolol100/Designchecker` is now the active public, read-only Website QA evidence runner through the live `Yolol100/Orchestrator` adapter registry. This repository is **rollback-only**, not an active default runner. Preserve its frozen runner, safety guards, contracts, and rollback availability during the documented regression period. It is maintenance-only for the Webactueel platform: preserve existing contracts and security, but add new generic browser/visual capabilities to Designchecker instead.

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

## Migration acceptance and remaining archive gates

The frozen Checklist parityset, formal evidence semantics, request/run/artifact correlation, independent Website QA owner acceptance and the live controller adapter switch to `Yolol100/Designchecker` have been verified. This is **Source GO for the compatibility/evidence contract only**, not approval of any concrete website or release. See `Yolol100/Designchecker/docs/CHECKLIST-MIGRATION-EVIDENCE.md` for the exact acceptance receipt.

Before archiving this repository, verify all remaining gates:

1. The central controller repository/package is synchronized and validated against the live Designchecker adapter route.
2. No active controller callsite selects Checklist except for an explicit rollback.
3. The regression window has completed with repeated parity and tested rollback availability.
4. The central portfolio tracker records archive readiness and approval.

Until then, keep this repository available for **explicit rollback only**; do not start new default runs, add features, or claim a website/release Go from repository results.
