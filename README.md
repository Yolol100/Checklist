# Webactueel Checklist QA Runner

Publieke read-only QA-evidencerunner voor Project Checklist. ChatGPT gebruikt de bestaande GitHub-koppeling om GitHub Actions uit te voeren; deze repository is **geen** QA-beleidslaag.

## Keten

`webactueel-workflow → website-qa-checklist → live Drive-bronnen → GitHub raw runner → Website QA policy-evaluation → GitHub formalizer → Evidence Manifest 3.0 → releasegates → webactueel-workflow`

- **Webactueel Workflow** — controller bij gecoördineerd/beheerd werk.
- **Website QA Skill** — QA-eigenaar voor scope, labels, severity/prioriteit, interpretatie en releaseadvies.
- **Google Drive Project Checklist** — actuele projectwaarheid.
- **Deze repository** — remote read-only evidencecollectie, immutable JSON-history, korte browser-artifactretentie en deterministische manifesttransformatie.

## Raw request — append-only

Productieruns gebruiken geen gedeeld `current/latest`-slot. Maak één nieuw bestand:

`requests/queue/<request_id>.json`

De bestandsnaam moet exact gelijk zijn aan `request_id`; een ID wordt nooit hergebruikt. Iedere request bevat onder meer:

- publieke URL zonder credentials/queryparameters;
- `level`: `quick`, `standard` of `full`;
- `task_type`: `audit`, `live_smoke` of `release_verification`;
- `target_environment`: `production`, `staging` of `public_test`;
- actuele `source_set_version` en manifest-SHA-256;
- unieke vooraf gelezen bronnen plus exact één SHA-256 per bron.

Voor `release_verification` zijn active `09` en `13` verplicht naast de vaste bronpreflight.

De workflow schrijft alleen `results/runs/<request_id>.json` terug naar Git. `results/latest.json` is uitsluitend een lokale/CI-compatibiliteitspointer en geen productie-interface.

## Browser evidence

Na `domcontentloaded`:

1. moet `body` zichtbaar zijn;
2. wordt op DOM mutation-quiescence gewacht;
3. wordt de gerenderde DOM/readiness-inventaris vastgelegd;
4. daarna worden DOM-observaties en axe uitgevoerd.

Hardening:

- iedere HTTP(S)-browserrequest wordt opnieuw tegen de public-network guard gecontroleerd;
- Service Workers zijn geblokkeerd zodat request interception niet wordt omzeild;
- WebSocket-egress is geblokkeerd en wordt als beperking geregistreerd;
- documentnavigaties met queryparameters worden geweigerd;
- interne linkchecks gebruiken maximaal zes gelijktijdige requests;
- credentials, URL-query's/fragments en veelvoorkomende tokenpatronen worden uit repository-evidence verwijderd.

Screenshots, DOM-inventory, volledige axe JSON en Playwright traces worden als GitHub Actions artifact bewaard met 7 dagen retentie. Nieuwe browserartifacts worden niet meer in Git-history gecommit.

## Formele policy — append-only

Website QA schrijft na interpretatie één nieuw bestand:

`policy/queue/<evaluation_id>.json`

De workflow bouwt en valideert daarna:

`results/formal/<evaluation_id>.json`

De formalizer kiest zelf nooit severity, status, prioriteit of releasebesluit. Hij valideert bron/schema-binding, runtime-evidence en cross-field claims. `public_test` of een willekeurige publieke staging-URL mag niet als `production_observation` worden gepresenteerd. Volledige `go` vereist onder meer een daadwerkelijk `required+passed` `RT-STAGING`-item en `staging_access=true`.

Voor cleanup, scan-fix, release verification en security retest blijven minstens twee verschillende stabiele raw rondes verplicht.

## Reproduceerbaarheid en supply chain

- Node 22 op `ubuntu-24.04`;
- `playwright` en `axe-core` exact gepind in `package-lock.json`;
- `npm ci --ignore-scripts --no-audit --no-fund`;
- Playwright wordt via de lokaal geïnstalleerde CLI gestart, niet via een `npx`-fallback;
- GitHub Actions zijn op volledige 40-teken commit-SHA's gepind;
- CI gebruikt `contents: read`; alleen de twee append-only write workflows krijgen `contents: write`;
- concurrerende resultwrites gebruiken bounded rebase/push retries en schrijven unieke paden.

## Automatische observaties

Onder andere publieke HTTP-status/redirects/headers, rendered title/meta/canonical/robots/H1/forms/alt, interne linksteekproef, robots.txt, Chromium desktop, mobiele viewportemulatie, axe-core, `lang`, viewport-meta, console/page-errors, mixed content en synthetische navigation timing.

Niet automatisch bewezen zijn onder andere keyboard/zoom, echte screenreader/AT, echte Safari/iOS/device, inboxbezorging, form submit, checkout/betalingen/orders, authenticated flows, formele WCAG-conformiteit, representatieve staging/rollback en echte Core Web Vitals-velddata.

## Privacygrens

De repository is publiek. Een queue-request blijft in Git-history staan en maakt dus de doel-hostnaam en het pad publiek. Gebruik deze route niet voor vertrouwelijke staginghosts, geheime/unpublished paden, persoonsgegevens of secrets. De v0.6-redactie voorkomt toekomstige query/tokenlekken in repository-evidence, maar wist eerder gecommitteerde historische artifacts niet uit Git-history.

## Belangrijkste bestanden

- `SKILL.md` — project-specifiek capability-adaptercontract
- `requests/queue/` — append-only productie-requests
- `policy/queue/` — append-only policy-evaluations
- `results/runs/` — immutable raw JSON
- `results/formal/` — immutable formele manifests
- `src/net.js` — SSRF/public-network guard
- `src/browser.js` — Playwright/axe/readiness/network guard
- `src/contracts.js` — strict queue/request contracts
- `src/privacy.js` — repository-evidence-redactie
- `src/concurrency.js` — begrensde read-only probes
- `src/run.js` — raw evidence
- `src/finalize.js` — raw+policy → formeel manifest
- `src/validate-result.js` — raw contractvalidatie
- `src/validate-formal.js` + `src/validate-formal-hardening.js` — formele semantische/claimvalidatie
- `.github/workflows/` — CI, raw runner en formalizer

Drive blijft de projectwaarheid. Deze repository bepaalt nooit zelfstandig of een site `Geslaagd`, `Mislukt`, `Go` of `No-go` is.
