# Webactueel Checklist QA Runner

Gratis, publieke read-only QA-evidencerunner voor Project Checklist. ChatGPT Web gebruikt de bestaande GitHub-koppeling om GitHub Actions uit te voeren; de repository is **geen** QA-beleidslaag.

## Eén gesloten keten

`webactueel-workflow → website-qa-checklist → live Drive-bronnen → GitHub raw runner → website-qa-checklist policy-evaluation → GitHub formalizer → Evidence Manifest 3.0 → releasegates → webactueel-workflow`

Rollen:

- **Webactueel Workflow** — controller bij gecoördineerd/beheerd werk.
- **Website QA Skill** — QA-eigenaar: scope, labels, severity/prioriteit, interpretatie en releaseadvies.
- **Google Drive Project Checklist** — actuele projectwaarheid en capabilityregistratie.
- **Deze repository** — remote read-only evidencecollectie, immutable run history en deterministische manifesttransformatie.

## Fase 1 — bronpreflight en raw evidence

Iedere request bevat:

- actuele `source_set_version`;
- canonieke manifest-SHA-256;
- exact vooraf gelezen bronnen;
- SHA-256 van iedere geselecteerde bron;
- scope/selectiebasis en taaktype.

Minimaal worden vóór een run gelezen:

- `active/00-project-index-en-router.md`
- `active/01-qa-proces-en-severity.md`
- `active/11-evidence-levels-runtime-matrix.md`
- `support/82-tool-en-browsermatrix.md`
- `support/83-evidence-manifest-schema.json`
- `support/84-runtime-matrix-schema.json`
- `support/87-master-project-checklist.md`
- `support/88-playwright-axe-adapter.md`

Voor `release_verification` daarnaast `active/09-release-go-no-go-en-hertest.md` en `active/13-release-scoring-and-claim-gates.md`.

De runner weigert incomplete bronpreflight of ontbrekende bronhashes.

`Run Checklist` levert:

- `results/latest.json` — laatste `raw-evidence-v1`;
- `results/runs/<request_id>.json` — immutable run history;
- `artifacts/runs/<request_id>/...` — screenshots, DOM/readiness-inventaris, volledige axe-JSON en Playwright traces.

## Dynamische UI-readiness

De browserharness baseert DOM-bevindingen niet meer primair op server-HTML. Na `domcontentloaded`:

1. moet `body` zichtbaar zijn;
2. wordt op DOM mutation-quiescence gewacht;
3. wordt de gerenderde DOM/readiness-inventaris vastgelegd;
4. daarna worden title/meta/H1/forms/alt/interne links en axe beoordeeld.

Er wordt geen `networkidle`-claim of algemene blinde sleep gebruikt. Als de browserlaag ontbreekt, wordt server-HTML expliciet als fallback gemarkeerd.

## Fase 2 — policy-evaluation en formeel manifest

De runner kiest nooit zelf severity, prioriteit of Go/No-Go. `policy_evaluation` in raw evidence blijft `null`.

Na broninterpretatie schrijft Website QA alleen `policy/current.json` (`policy-evaluation-v1`) met:

- source-/schema-binding;
- scope;
- benodigde runtime-items;
- in-scope onuitgevoerde tests;
- bevindingen met owner/severity/status;
- rollback/monitoring;
- releasebesluit;
- gebruikte raw round-request-ID's.

`Finalize Checklist` zet dit deterministisch om naar `results/formal-latest.json` en valideert Evidence Manifest 3.0/Runtime Matrix 2.0 semantiek. Voor release/stabiele taken zijn twee **verschillende** raw runs verplicht; één run mag niet worden gedupliceerd als twee rondes.

## Reproduceerbaarheid

- Node 22 in GitHub Actions;
- exact gepinde `playwright` en `axe-core`;
- `package-lock.json` lockfile v3;
- workflows gebruiken `npm ci`;
- bron- en schemahashes zijn onderdeel van het request/beleid;
- raw run history en artifactpaden zijn request-ID-gebonden.

## Uitgevoerde automatische observaties

- publieke HTTP-status, redirects en responseheaders;
- HTTPS/securityheader-aanwezigheid;
- rendered title, meta description, canonical, robots/noindex;
- rendered H1, afbeeldingen/alt en formulierdetectie zonder submit;
- interne linksteekproef en robots.txt;
- Chromium desktop + mobiele viewportemulatie;
- axe-core;
- `lang`, viewport-meta, console/page-errors en mixed content;
- synthetische navigation timing.

## Bewijsgrenzen

Niet automatisch bewezen:

- keyboard/zoom;
- echte screenreader/AT;
- echte iPhone/iPad of echte Safari/iOS;
- inboxbezorging;
- formulierinzending;
- checkout/betalingen/orders;
- ingelogde flows;
- formele WCAG-conformiteit;
- echte Core Web Vitals-velddata.

Publieke netwerkobservaties kunnen `production_observation` ondersteunen voor wat live is waargenomen. GitHub Actions Playwright/axe blijft `controlled_runtime`; mobiele emulatie is `emulated`.

## Veiligheid

- alleen publieke `http`/`https` targets;
- private/lokale/gereserveerde netwerken en unsafe redirects geblokkeerd;
- credentials en queryparameters geweigerd;
- geen login, form submit, betaling, order of andere targetmutatie;
- repository is publiek: geen secrets, persoonsgegevens of vertrouwelijke stagingpaden in request/policy.

## Belangrijkste bestanden

- `SKILL.md` — capability-adaptercontract
- `requests/current.json` — source-first raw request
- `policy/current.json` — Website QA policy-evaluation
- `src/browser.js` — Playwright/axe/readiness/artifacts
- `src/checklist.js` — neutrale observaties
- `src/run.js` — bronpoort, raw evidence en run history
- `src/finalize.js` — deterministic raw+policy → formeel manifest
- `src/validate-result.js` — raw contractvalidatie
- `src/validate-formal.js` — formele semantische validatie
- `.github/workflows/run-checklist.yml` — raw runner
- `.github/workflows/finalize-checklist.yml` — formalizer
- `.github/workflows/ci.yml` — volledige regressiegate

Drive blijft de projectwaarheid. Deze repository bepaalt nooit zelfstandig of een site `Geslaagd`, `Mislukt`, `Go` of `No-go` is.
