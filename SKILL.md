---
name: checklist-runner-adapter
description: Start the Yolol100/Checklist GitHub Actions evidence runner for public read-only website QA after the installed website-qa-checklist Skill has loaded the live Project Checklist manifest and required Google Drive sources. Use this only as a capability adapter; it never owns QA policy, priority, status mapping or release decisions.
---

# Checklist Runner Adapter

## Ownership

- `webactueel-workflow` remains controller when the assignment is coordinated/managed.
- `website-qa-checklist` remains the QA owner.
- Registered Google Drive Project Checklist sources remain project truth.
- `Yolol100/Checklist` is only the remote execution/evidence layer.

## Mandatory source-first order

Before writing `requests/current.json`:

1. Load the installed `website-qa-checklist` Skill.
2. Read the live `PROJECT-MANIFEST.json.md` from the registered Project Checklist Drive root and capture `source_set_version` plus canonical manifest SHA-256.
3. Read at minimum:
   - `active/00-project-index-en-router.md`
   - `active/01-qa-proces-en-severity.md`
   - `active/11-evidence-levels-runtime-matrix.md`
   - `support/87-master-project-checklist.md`
   - `support/82-tool-en-browsermatrix.md`
   - `support/88-playwright-axe-adapter.md`
4. For `release_verification`, also read:
   - `active/09-release-go-no-go-en-hertest.md`
   - `active/13-release-scoring-and-claim-gates.md`
5. Determine scope, level, task type, selection basis, mandatory manual layers and the requested final claim before invoking GitHub.

Do not scan first and invent policy from the output afterward.

## Request contract

Write a unique request to `requests/current.json` containing:

- `request_id`
- public URL without credentials or query parameters
- `level`: `quick`, `standard` or `full`
- `task_type`: `audit`, `live_smoke` or `release_verification`
- timestamp and requester
- `source_context.project_id = project-checklist`
- current `source_set_version`
- current canonical `manifest_sha256`
- `selection_basis`
- exact `selected_sources` already read

The runner rejects incomplete source preflight. A release request is rejected unless sources `09` and `13` are included.

## Execution

1. Read the current request through the connected GitHub app.
2. Replace it with the source-complete request.
3. The write to `main` triggers `Run Checklist`.
4. Follow the matching GitHub Actions run until completion; do not claim completion while queued/running.
5. Read `results/latest.json`.
6. Accept it only when `request.request_id`, `source_context.source_set_version` and `source_context.manifest_sha256` match the request.
7. Load additional domain sources named in `observations[].source_refs` only where interpretation requires them.
8. Apply `website-qa-checklist` to convert raw evidence to the formal Evidence Manifest 3.0 / Runtime Matrix 2.0 and canonical Checklist labels.
9. Apply release gates only in the Skill/controller, never in repository code.

## Raw evidence boundary

`results/latest.json` uses `raw-evidence-v1`. It may contain:

- public HTTP/redirect/header observations;
- HTML/SEO observations;
- internal-link and robots observations;
- Chromium desktop/mobile-emulation evidence;
- axe summaries plus full axe JSON artifacts;
- full-page screenshots and Playwright traces;
- console/page errors and mixed-content evidence;
- synthetic navigation timing;
- unexecuted/manual evidence gaps.

The raw runner must not output canonical `status`, `priority`, `severity`, `confidence` or a release `decision`. Those are owned by `website-qa-checklist` plus the active Drive sources.

## Evidence limits

- GitHub Actions Chromium is remote synthetic execution, not a local Chat browser.
- A public live run can support `production_observation` for what was actually observed, but mobile emulation stays `execution_mode: emulated` and never becomes real-device or Safari/iOS evidence.
- axe is supplementary and does not establish WCAG conformance.
- No keyboard, zoom, real screenreader, true iOS/Safari, inbox delivery, authenticated flow, payment, order or form-submission proof is produced.
- Synthetic timing is not CrUX/RUM field evidence.

## Safety

- Public read-only targets only.
- Reject local/private/reserved targets, credentials and query parameters.
- Never authenticate, submit forms, order, pay or mutate the target website.
- The repository is public: never put secrets, personal data or confidential staging paths in a request.

## Failure rule

If Drive source preflight, GitHub write access, Actions execution or evidence readback is unavailable, return `Geblokkeerd`/`handoff_required` according to the Website QA sources. Do not ask for an extra API key, tunnel or paid QA account as a fallback.
