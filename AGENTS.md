# Checklist QA repository instructions

## Scope
- This repository is a public read-only QA evidence adapter for `website-qa-checklist`; it never owns severity, acceptance or the final Go/No-Go decision.
- `webactueel-workflow` remains the controller for cross-skill routing, source selection, handoffs and total workflow closure.
- Prefer a native Work/Codex browser or local Playwright route when it can supply the same bounded evidence class. Use this repository when immutable run bundles, reproducible cross-browser evidence or persisted QA artifacts are required.

## Before changing files
- Read `README.md`, `package.json`, the request/result contracts and `.github/workflows/run-checklist.yml`.
- Keep `main` generic. Concrete targets, `requests/queue/`, `policy/queue/` and `results/runs/` belong only to temporary `runtime/**` branches and run artifacts.
- Preserve public-target/SSRF guards, GET/HEAD-only browser networking, privacy redaction and immutable request/result correlation.
- Do not commit customer credentials, authenticated-session data, private screenshots, traces, DOM dumps or other run-specific residue.

## Validation
Use the locked dependency graph and repository scripts:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

When result/finalization contracts change, also run the relevant `validate-result`, `finalize` and `validate-formal` scripts against repository fixtures.

## Evidence boundaries
- Automated axe/browser evidence does not prove complete WCAG conformance, real assistive technology, real Safari/iOS, authenticated flows or payment correctness.
- Lighthouse is lab evidence, not field Core Web Vitals.
- A successful repository run supplies bounded evidence only; `website-qa-checklist` owns severity, acceptance, hertest and release advice.
- Do not merge, publish or declare production Go solely because repository checks are green.
