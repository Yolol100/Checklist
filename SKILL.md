---
name: checklist-runner-adapter
description: Start the project-specific Yolol100/Checklist GitHub Actions evidence runner for public read-only Project Checklist QA after website-qa-checklist has loaded the live manifest and required Drive sources, then finalize the source-bound policy evaluation into Evidence Manifest 3.0. Use only as a capability adapter; it never owns QA policy, priority, status mapping or release decisions.
---

# Checklist Runner Adapter

## Ownership

- `webactueel-workflow` remains controller for coordinated/managed work.
- `website-qa-checklist` remains QA owner and interprets raw observations into canonical status, severity, priority and release advice.
- Live Google Drive Project Checklist sources remain project truth.
- `Yolol100/Checklist` is remote execution, immutable geredigeerde raw/formal JSON persistence and deterministic manifest transformation only.

## Discovery boundary

This repository contract does not install or globally register itself as a ChatGPT Skill. Until the live Project Checklist capability source and the installed `website-qa-checklist` package snapshot can be updated atomically, invoke this adapter only when explicit user/project context identifies `Yolol100/Checklist`. Never update Drive registration alone and create Skill↔source drift.

## Phase 1 — source-first raw evidence

Before writing a queue request:

1. Load `website-qa-checklist`.
2. Read the live Project Checklist manifest and capture `source_set_version` plus canonical manifest SHA-256.
3. Read at minimum `00`, `01`, `11`, `82`, `83`, `84`, `87` and `88` plus task-relevant active sources.
4. For `release_verification`, also read active `09` and `13` before execution.
5. Capture the SHA-256 of every selected source from the live manifest/SHA256SUMS.
6. Determine scope, scan level, task type, target environment, mandatory manual layers and requested final claim before GitHub execution.

Never scan first and invent policy from output afterward.

### Request contract

Create exactly one new file `requests/queue/<request_id>.json`. The filename must equal `request_id`; IDs are 3-80 characters using only letters, digits, `.`, `_` and `-`. Never overwrite or reuse an existing request ID. The triggercommit itself must contain exactly this one queuefile and no code/workflow changes.

Required request fields:

- `request_id`;
- public URL without credentials or query parameters;
- `level`: `quick`, `standard` or `full`;
- `task_type`: `audit`, `live_smoke` or `release_verification`;
- `target_environment`: `production`, `staging` or `public_test`;
- timestamp/requester;
- `source_context.project_id = project-checklist`;
- current `source_set_version` and canonical `manifest_sha256`;
- `selection_basis`;
- unique `selected_sources` already read;
- exactly one valid SHA-256 in `source_hashes` for every selected source and no unselected hash entries.

The runner fails closed on malformed IDs, unknown levels/environments, incomplete source preflight, duplicate sources, missing hashes and missing release sources.

### Raw execution

1. Create the source-complete queue request on `main` through the connected GitHub app.
2. Follow the matching `Run Checklist` workflow to completion.
3. Read only `results/runs/<request_id>.json`; do not use a shared `latest` file as production evidence.
4. Accept it only when request ID, source-set version, manifest SHA and selected source hashes match the preflight.
5. In this public-repository route, full screenshot/trace/full-axe/DOM artifacts are deliberately **not persisted or uploaded**. Accept compact redacted/hash-bound browser and axe evidence only.
6. If the QA scope requires full browser artifacts, mark that evidence layer `Geblokkeerd`/`Te controleren` and route to a private/approved evidence store or runtime instead of weakening the public route.
7. Load additional domain sources in `observations[].source_refs` when interpretation requires them.

Raw JSON remains `raw-evidence-v1`; `policy_evaluation` must remain `null`.

## Phase 2 — Website QA policy evaluation

1. Apply `website-qa-checklist` and the already loaded live sources to determine scope-specific findings, owners, severity/status, required runtime layers, in-scope unexecuted tests, rollback/monitoring state and release decision.
2. Do not hand-build Evidence Manifest 3.0.
3. Create exactly one new `policy/queue/<evaluation_id>.json` using `policy-evaluation-v1`; filename and `evaluation_id` must match and the ID must follow the same safe identifier contract. Its triggercommit must also contain exactly one queuefile.
4. Bind the policy to the exact accepted `request_id`, Project Checklist source-set/manifest hashes and current `83`/`84` schema hashes.
5. For cleanup, scan-fix, release verification and security retest, provide at least two distinct completed raw request IDs. Never duplicate one run to simulate stability.
6. When release scope requires representative staging, include `RT-STAGING` in `required_runtime_ids`; the public runner cannot mark it passed by itself.
7. Follow `Finalize Checklist` and read only `results/formal/<evaluation_id>.json` after the workflow succeeds.

Repository code may validate and transform policy fields but never chooses severity, canonical status or release decision itself.

## Dynamic UI and network evidence

The Chromium harness:

- requires a visible body, then waits for DOM mutation quiescence instead of `networkidle` or blind sleeps;
- routes public HTTP(S) traffic through a local DNS-pinning proxy so the validated DNS result is the IP actually contacted;
- accepts only standard public web ports 80/443 and blocks private/special-purpose/documentation/benchmark/transition address ranges;
- revalidates browser requests and permits only `GET`/`HEAD`; write-method attempts are blocked before network and recorded;
- blocks Service Workers so Playwright routing cannot be bypassed;
- blocks WebSocket egress, non-proxied WebRTC UDP and QUIC;
- rejects document navigations with query parameters;
- excludes query-bearing internal links from automatic probes and reports them as skipped, not broken;
- collects rendered DOM/readiness before axe and before deriving title/H1/form/alt/link observations;
- uses a maximum of six concurrent queryless internal-link probes;
- removes credentials, query strings/fragments, email addresses and common token/JWT patterns from repository evidence;
- stores only a safe response-header allowlist; cookies/authentication are discarded and CSP is presence-only.

Service-Worker/WebSocket-dependent behavior, query-specific routes and any blocked write-dependent behavior may require a separate approved browser test.

## Evidence boundaries

- `production_observation` is only eligible when the request explicitly declares `target_environment: production` and the corresponding live observation actually executes.
- `public_test` and generic public staging URLs do not become production evidence merely because they are public.
- Playwright/axe from GitHub Actions remains `controlled_runtime`.
- Mobile viewport emulation uses `execution_mode: emulated`.
- `RUNTIME-BROWSER-ARTIFACT-PERSISTENCE` is `not_executed` on the public-repository route; compact redacted/hash-bound evidence does not replace a required full trace/screenshot/DOM review.
- A public staging URL does not prove representative staging, database/roles/integrations or rollback; use `RT-STAGING` when that layer is required.
- No automatic claim for keyboard, zoom, screenreader, real device, real Safari/iOS, inbox delivery, payment, authenticated flow, formal WCAG conformity or field Core Web Vitals.

## Safety and privacy

- Public read-only targets only.
- Reject local/private/reserved/documentation/special-purpose IP ranges, unsafe redirects, non-standard webports, credentials and top-level query parameters.
- Browser HTTP methods are GET/HEAD-only. Never intentionally submit forms, authenticate, place orders, run payments or mutate the target.
- The repository is public. A queue request permanently exposes its target hostname/path in Git history; never use this route for confidential staging URLs, persoonsgegevens, secrets or unpublished client paths.
- Public production runs never publish full browser screenshots, traces, full axe JSON or DOM snapshots. Historical artifacts in earlier Git commits are not automatically erased by this change.
- Preserve `Geblokkeerd`/`Te controleren` where required evidence is unavailable.
- Drive remains authoritative; GitHub results never become project truth.

## Output

Lead with the canonical Website QA decision, then failed/blocked points, tested scope, untested scope and highest evidence layer. For managed work, return completion evidence to `webactueel-workflow`.

## Failure rule

If source preflight, GitHub write access, Actions, raw validation or formal finalization fails, report `Geblokkeerd`/`handoff_required` according to Website QA sources. Do not invent an API-key, tunnel or paid-service fallback.
