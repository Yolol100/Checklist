---
name: checklist-runner-adapter
description: Run the registered Yolol100/Checklist GitHub Actions evidence adapter for public read-only Project Checklist QA after website-qa-checklist loads the live source manifest and required Drive sources. The repository never owns QA policy, priority, canonical status, severity or release decisions.
---

# Checklist Runner Adapter

## Ownership and registration

- `webactueel-workflow` remains controller for coordinated work.
- `website-qa-checklist` remains QA owner and interprets raw observations into canonical status, severity, priority and release advice.
- Live Google Drive Project Checklist sources remain project truth.
- `Yolol100/Checklist` is now the registered public read-only execution/evidence adapter described by Project Checklist source-set `2026-08-15.2-checklist-github-adapter`.
- The repository may collect bounded evidence and deterministically validate/transform already-decided policy fields; it never invents QA policy or closes the workflow.

## When to run

Run this adapter only when Website QA has decided that public read-only controlled-runtime browser/axe evidence can change the requested QA decision and all source/readback prerequisites below are available. Do not run it merely because GitHub is connected.

Do not use this public repository route for confidential staging URLs, credentials, query-bearing secrets, personal data, authenticated flows, payment/order mutations, or when full screenshots/traces/DOM/full-axe artifacts are required for the claim.

## Source-first preflight

Before writing a queue request:

1. Load `website-qa-checklist`.
2. Read the live Project Checklist manifest and capture its `source_set_version` plus canonical manifest SHA-256.
3. Read at minimum Project Checklist sources `00`, `01`, `11`, `82`, `83`, `84`, `87` and `88`, plus task-relevant active sources. For `release_verification`, also read `09` and `13`.
4. Capture the manifest SHA-256 for every selected source.
5. Determine scope, QA level, task type, target environment, mandatory manual layers and requested final claim before GitHub execution.
6. Confirm GitHub can create the queue request, observe the matching Actions run and read the request-bound result afterward.

Never scan first and infer policy from output afterward.

## Request contract: what, why, when, how and for whom

Create exactly one new file below repository folder `requests/queue`; its filename is the unique `request_id` plus `.json`. Never overwrite or reuse a request ID. The trigger commit must contain exactly that new queue file and no code/workflow change.

Required request semantics:

- **for whom / scope:** `requester`, public URL and `target_environment`;
- **what:** `task_type` (`audit`, `live_smoke` or `release_verification`) and `level` (`quick`, `standard` or `full`);
- **why:** `selection_basis` explaining why this controlled-runtime evidence is needed;
- **when:** the current Project Checklist source-set and requested claim determine whether the run is valid now;
- **how:** `selected_sources` plus exact `source_hashes`, canonical manifest SHA and the bounded public read-only runner.

The request must also include the current `source_context.project_id = project-checklist`, `source_set_version`, canonical `manifest_sha256`, timestamp and requester. IDs are 3-80 characters using only letters, digits, `.`, `_` and `-`.

The runner fails closed on malformed IDs, unknown levels/environments, incomplete source preflight, duplicate sources, missing hashes and missing release sources.

## Phase 1 — raw execution

1. Create the source-complete request on `main` through the connected GitHub app.
2. Follow the matching `Run Checklist` workflow to completion.
3. Read only the result whose filename matches the exact `request_id` below `results/runs`; never use a shared `latest` file as production evidence.
4. Accept it only when request ID, source-set version, manifest SHA and selected source hashes match preflight.
5. Treat repository output as `raw-evidence-v1`; `policy_evaluation` must remain `null`.
6. The public route stores only compact, redacted/hash-bound browser and axe evidence. Full screenshot/trace/full-axe/DOM artifacts are deliberately not persisted.
7. If the QA claim requires a missing evidence layer, preserve `Geblokkeerd`/`Te controleren` and route to a private or otherwise approved runtime rather than weakening the claim.

## Phase 2 — Website QA policy evaluation

1. Apply `website-qa-checklist` and the already-loaded live Project Checklist sources to choose findings, owners, severity/status, required runtime layers, in-scope unexecuted tests, rollback/monitoring state and release decision.
2. Create one new policy request below repository folder `policy/queue`; filename and `evaluation_id` must match and use the same safe identifier rules.
3. Bind the policy request to the exact accepted raw `request_id`, current source-set/manifest hashes and current schema-source hashes.
4. For cleanup, scan-fix, release verification and security retest, provide at least two distinct completed raw request IDs. Never duplicate one run to simulate stability.
5. When release scope requires representative staging, include the canonical representative-staging runtime requirement. The public runner cannot mark that layer passed by itself.
6. Follow `Finalize Checklist` and read only the formal result whose filename matches the exact `evaluation_id` below `results/formal`.

Repository code may validate and transform supplied policy fields but never chooses severity, canonical status or release decision itself.

## Browser and network boundary

The Chromium harness remains read-only and fail-closed:

- require a visible page and meaningful DOM readiness rather than `networkidle` or blind sleeps;
- pin validated DNS through the local proxy before contact;
- allow only standard public web ports and block private/special-purpose/documentation/benchmark/transition address ranges;
- permit browser HTTP `GET`/`HEAD` only and block write methods before network;
- block Service Workers, WebSocket egress, non-proxied WebRTC UDP and QUIC where the harness contract specifies;
- reject document navigations with query parameters and skip query-bearing internal links rather than probing them automatically;
- bound internal-link concurrency;
- redact credentials, query strings/fragments, email addresses and token-like values from repository evidence;
- persist only safe response-header data and discard cookies/authentication.

Service-Worker/WebSocket-dependent behavior, query-specific routes and write-dependent behavior require another approved test route.

## Evidence boundaries

- `production_observation` is eligible only when the request explicitly targets production and the corresponding live observation actually executes.
- Public test/staging does not become production evidence just because it is reachable.
- Playwright/axe from GitHub Actions remains `controlled_runtime`; mobile viewport emulation remains emulated evidence.
- Compact redacted evidence does not replace required full browser artifacts.
- Public staging does not prove representative data, roles, integrations or rollback.
- Do not automatically claim keyboard, zoom, screenreader, real-device, real Safari/iOS, inbox delivery, payment, authenticated-flow, formal WCAG-conformance or field Core Web Vitals evidence.

## Safety and privacy

- Public read-only targets only.
- Never intentionally submit forms, authenticate, place orders, run payments or mutate the target.
- The repository is public: a queue request exposes its target hostname/path in Git history. Do not place confidential or personal information in requests or results.
- Historical artifacts in older commits are not erased by this contract change.
- Drive remains authoritative; GitHub results never become project truth.

## Output and failure rule

Lead with the canonical Website QA decision, then failed/blocked points, tested scope, untested scope and highest evidence layer. For managed work, return completion evidence to `webactueel-workflow`.

If source preflight, GitHub write access, Actions, raw validation or formal finalization fails, report `Geblokkeerd`/`handoff_required` according to Website QA sources. Do not invent a credential, tunnel or paid-service fallback.
