# Webactueel Checklist QA Runner

Gratis, read-only evidence-runner voor de geïnstalleerde `website-qa-checklist` Skill. ChatGPT Web gebruikt de bestaande GitHub-koppeling om GitHub Actions te starten; de repository is **niet** de QA-beleidslaag.

## Eén keten

`webactueel-workflow → website-qa-checklist → live Drive-bronnen → GitHub Checklist Runner → raw evidence → website-qa-checklist → releasegates → webactueel-workflow`

De rollen zijn strikt gescheiden:

- **Webactueel Workflow**: controller bij gecoördineerd/beheerd werk.
- **Website QA Skill**: QA-eigenaar, scope, labels, prioriteit, evidence-interpretatie en releaseadvies.
- **Google Drive Project Checklist**: actuele projectwaarheid.
- **Deze repository**: alleen remote read-only evidencecollectie.

## Verplichte volgorde

ChatGPT mag de runner pas starten nadat de actuele Project Checklist-bronnen zijn gelezen.

Minimaal voor iedere run:

- `active/00-project-index-en-router.md`
- `active/01-qa-proces-en-severity.md`
- `active/11-evidence-levels-runtime-matrix.md`
- `support/82-tool-en-browsermatrix.md`
- `support/87-master-project-checklist.md`
- `support/88-playwright-axe-adapter.md`

Voor `release_verification` daarnaast verplicht:

- `active/09-release-go-no-go-en-hertest.md`
- `active/13-release-scoring-and-claim-gates.md`

`requests/current.json` bevat daarom het actuele `source_set_version`, de SHA-256 van het live projectmanifest, de vooraf gelezen bronnen en de `selection_basis`. De runner weigert een onvolledige bronpreflight.

## Gebruik vanuit ChatGPT

De gebruiker kan simpel vragen:

> Voer Checklist standaard uit op https://example.com

of:

> Doe een volledige releasecheck op https://example.com

ChatGPT doet de bronpreflight en GitHub-uitvoering. Er is geen extra QA-account, API-key, MCP-server, tunnel of betaalde testdienst nodig.

## Wat de runner uitvoert

- publieke HTTP-status, redirects en responseheaders
- HTTPS en aanwezigheid van belangrijke securityheaders
- title, meta description, canonical en robots/noindex-observaties
- H1 en ontbrekende `alt`-attributen
- interne linksteekproef en robots.txt
- formulierdetectie zonder submit
- Chromium via Playwright
- desktop + mobiele viewportemulatie
- axe-core
- `lang` en viewport-meta
- console/page-errors
- mixed-content requests
- synthetische navigation timing

## Reproduceerbaar bewijs

Bij iedere browserrun worden onder `artifacts/latest/` opgeslagen:

- volledige pagina-screenshot
- volledige axe-JSON
- Playwright trace

`results/latest.json` bevat hashes, toolversies, browserconfiguratie, evidence-ID's, source refs, runtimebeperkingen en onuitgevoerde tests.

## Raw evidence, geen beleid

De runner gebruikt contract `raw-evidence-v1`.

Hij geeft **geen** canonieke Checklist-status, prioriteit, severity, confidence of Go/No-Go-besluit. `policy_evaluation` blijft altijd `null`.

De Website QA Skill zet de raw evidence daarna om naar:

- `support/83-evidence-manifest-schema.json` (Evidence Manifest 3.0)
- `support/84-runtime-matrix-schema.json` (Runtime Matrix 2.0)
- canonieke labels en prioriteiten
- de toepasselijke releaseclaim

Daardoor kan bronbeleid veranderen zonder dat de GitHub-runner een tweede beleidswaarheid wordt.

## Bewijsgrenzen

De runner bewijst niet automatisch:

- keyboard- en zoomgedrag
- echte screenreader/assistive technology
- echte iPhone/iPad of echte Safari/iOS
- echte inboxbezorging
- formulierinzendingen
- checkout, betalingen en orders
- ingelogde flows
- formele WCAG-conformiteit
- echte Core Web Vitals-velddata

Een live publieke browserrun kan alleen `production_observation` ondersteunen voor wat daadwerkelijk is geobserveerd. Mobiele emulatie blijft `execution_mode: emulated` en wordt nooit echt-devicebewijs.

## Veiligheid

- alleen publieke `http`/`https`-targets
- lokale/private/gereserveerde IP-ranges geblokkeerd
- redirects opnieuw gevalideerd
- credentials en queryparameters geweigerd
- geen login, form submit, betaling, order of andere targetmutatie
- repository is publiek: geen secrets, persoonsgegevens of vertrouwelijke stagingpaden in requests

## Bestanden

- `SKILL.md` — adaptercontract; geen tweede QA-owner
- `requests/current.json` — source-first scanrequest
- `.github/workflows/run-checklist.yml` — uitvoeringsworkflow
- `.github/workflows/ci.yml` — syntax-, contract- en artifactvalidatie
- `src/net.js` — publieke netwerk/SSRF-beveiliging
- `src/browser.js` — Playwright + axe + artifacts
- `src/checklist.js` — neutrale observaties
- `src/run.js` — source-preflight en evidencepakket
- `src/validate-result.js` — blokkeert beleidsvelden/drift
- `results/latest.json` — laatste raw evidence
- `artifacts/latest/` — laatste screenshots, traces en volledige axe-JSON

## Projectwaarheid

Google Drive blijft de projectwaarheid. De repository kopieert geen Checklist-beleid en bepaalt nooit zelfstandig of een site `Go`, `No-go`, `Geslaagd` of `Mislukt` is.
