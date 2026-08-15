---
name: checklist-runner-adapter
description: Start the registered Yolol100/Checklist GitHub Actions evidence runner for public read-only Project Checklist QA after website-qa-checklist has loaded the live manifest and required Drive sources, then finalize the source-bound policy evaluation into Evidence Manifest 3.0. Use only as a capability adapter; it never owns QA policy, priority, status mapping or release decisions.
---

# Checklist Runner Adapter

## Ownership

- `webactueel-workflow` remains controller for coordinated/managed work.
- `website-qa-checklist` remains QA owner and is the only layer that interprets observations into canonical status, severity, priority and release advice.
- Registered Google Drive Project Checklist sources remain project truth.
- `Yolol100/Checklist` is remote execution, evidence persistence and deterministic manifest transformation only.

## Phase 1 — source-first raw evidence

Before writing `requests/current.json`:

1. Load `website-qa-checklist`.
2. Read the live Project Checklist manifest and capture `source_set_version` plus canonical manifest SHA-256.
3. Read at minimum:
   - `active/00-project-index-en-router.md`
   - `active/01-qa-proces-en-severity.md`
   - `active/11-evidence-levels-runtime-matrix.md`
   - `support/82-tool-en-browsermatrix.md`
   - `support/83-evidence-manifest-schema.json`
   - `support/84-runtime-matrix-schema.json`
   - `support/87-master-project-checklist.md`
   - `support/88-playwright-axe-adapter.md`
4. Read task-relevant domain sources before execution. For `release_verification`, also read `active/09-release-go-no-go-en-hertest.md` and `active/13-release-scoring-and-claim-gates.md`.
5. Capture the SHA-256 of every selected source from the live manifest/SHA256SUMS.
6. Determine scope, level, task type, selection basis, mandatory manual layers and requested final claim before GitHub execution.

Never scan first and invent policy from output afterward.

### Request contract

Write a unique `requests/current.json` with:

- `request_id`;
- public URL without credentials/query parameters;
- `level`: `quick`, `standard` or `full`;
- `task_type`: `audit`, `live_smoke` or `release_verification`;
- timestamp/requester;
- `source_context.project_id = project-checklist`;
- current `source_set_version` and canonical `manifest_sha256`;
- `selection_basis`;
- exact `selected_sources` already read;
- `source_hashes` for every selected source.

The runner fails closed on incomplete source preflight, missing source hashes or missing release sources.

### Raw execution

1. Write the source-complete request to `main` through the connected GitHub app.
2. Follow the matching `Run Checklist` workflow to completion.
3. Read `results/latest.json` and accept it only when request ID, source-set version, manifest SHA and selected source hashes match the preflight.
4. The same immutable raw run is stored as `results/runs/<request_id>.json`; browser artifacts live under `artifacts/runs/<request_id>/`.
5. Load additional domain sources in `observations[].source_refs` when interpretation requires them.

`results/latest.json` remains `raw-evidence-v1`; `policy_evaluation` must stay `null`.

## Phase 2 — Website QA policy evaluation

After raw evidence is accepted:

1. Apply `website-qa-checklist` and the already loaded live sources to determine scope-specific findings, owners, severity/status, required runtime layers, in-scope unexecuted tests, rollback/monitoring state and release decision.
2. Do not hand-build Evidence Manifest 3.0.
3. Write only `policy/current.json` using `policy-evaluation-v1`, bound to:
   - latest accepted `request_id`;
   - `project-checklist`, source-set version and manifest SHA;
   - current SHA-256 of `support/83-evidence-manifest-schema.json` and `support/84-runtime-matrix-schema.json`;
   - one or more raw `rounds` by request ID;
   - scope, required runtime IDs, findings and release decision.
4. For stable/release task types, provide two distinct completed raw request IDs. Never duplicate one run to simulate two rounds.
5. The `Finalize Checklist` workflow runs `src/finalize.js`, builds `results/formal-latest.json` deterministically and validates it with `src/validate-formal.js`.
6. Accept the formal result only when the workflow succeeds and the policy/source bindings still match.

Repository code may validate and transform policy fields but must never choose severity, canonical status or release decision itself.

## Dynamic UI evidence

The Chromium harness uses source `88` boundaries:

- navigate to the intended public state;
- require a visible `body`;
- wait for DOM mutation quiescence rather than `networkidle` or blind sleeps;
- collect a rendered DOM/readiness inventory before axe and before deriving title/H1/form/alt/link observations;
- use server HTML only as explicit fallback when rendered browser evidence is unavailable;
- preserve screenshot, DOM inventory, full axe JSON and Playwright trace with hashes.

## Evidence boundaries

- Public HTTP/robots/link observations may support `production_observation` for the live state actually observed.
- Playwright/axe from GitHub Actions remains `controlled_runtime`.
- Mobile viewport emulation uses `execution_mode: emulated`.
- No automatic claim for keyboard, zoom, screenreader, real device, real Safari/iOS, inbox delivery, payment, authenticated flow, formal WCAG conformity or field Core Web Vitals.

## Safety

- Public read-only targets only.
- Reject private/local/reserved targets, unsafe redirects, credentials and query parameters.
- Never submit forms, authenticate, place orders, run payments or mutate the target.
- Repository is public: never write secrets, persoonsgegevens or confidential staging paths into requests/policy.
- Preserve `Geblokkeerd`/`Te controleren` where required evidence is unavailable.
- Drive remains authoritative; GitHub results never become project truth.

## Output

Lead with the canonical Website QA decision, then failed/blocked points, tested scope, untested scope and highest evidence layer. For managed work, return completion evidence to `webactueel-workflow`.

## Failure rule

If source preflight, GitHub write access, Actions, raw validation or formal finalization fails, report `Geblokkeerd`/`handoff_required` according to Website QA sources. Do not invent an API-key/tunnel/paid-service fallback.
