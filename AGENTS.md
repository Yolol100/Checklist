# Checklist QA repository instructions

## Platform status

This repository is the active legacy Website QA evidence runner during the controlled migration to `Yolol100/Designchecker`. Read `MIGRATION.md` before changing behavior. Keep existing contracts working, but place new generic browser, accessibility, performance and visual capabilities in Designchecker.

## Scope

- Supply public read-only QA evidence for `website-qa-checklist`.
- Never own severity, acceptance or final Go/No-Go.
- Keep `webactueel-workflow` as controller for routing, sources, handoffs and closure.
- Use Designchecker as the target consolidated runtime only after formal-evidence parity is proven.

## Before changing files

- Read `README.md`, `MIGRATION.md`, `package.json`, request/result contracts and `.github/workflows/run-checklist.yml`.
- Keep `main` generic. Concrete targets, `requests/queue/`, `policy/queue/` and `results/runs/` belong only to temporary runtime branches and run artifacts.
- Preserve public-target/SSRF guards, GET/HEAD-only networking, privacy redaction and immutable request/result correlation.
- Never commit credentials, authenticated-session data, private screenshots, traces, DOM dumps or customer/run residue.

## Validation

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm test
```

When result/finalization contracts change, also run the relevant `validate-result`, `finalize` and `validate-formal` scripts against repository fixtures.

## Evidence boundaries

- Automated browser/axe evidence does not prove complete WCAG conformance, assistive technology, real Safari/iOS, authenticated flows or payments.
- Lighthouse is lab evidence, not field Core Web Vitals.
- A successful repository run supplies bounded evidence only.
- `website-qa-checklist` owns severity, acceptance, hertest and release advice.
- Do not merge, publish, retire this route or declare production Go solely because checks are green.

## Migration rules

Allowed changes are security/compatibility fixes, existing-contract repairs, parity fixtures/tests and minimal extraction work. Do not add a new independent platform capability or weaken an evidence/network/privacy gate. Retire the repository only after every exit gate in `MIGRATION.md` has passed.
