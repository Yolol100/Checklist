# Webactueel Checklist QA Runner

Publieke read-only QA-evidencerunner voor Project Checklist. ChatGPT gebruikt de bestaande GitHub-koppeling om GitHub Actions uit te voeren; deze repository is **geen** QA-beleidslaag.

## Keten

`webactueel-workflow → website-qa-checklist → live Drive-bronnen → GitHub raw runner → Website QA policy-evaluation → GitHub formalizer → Evidence Manifest 3.0 → releasegates → webactueel-workflow`

- **Webactueel Workflow** — controller bij gecoördineerd/beheerd werk.
- **Website QA Skill** — QA-eigenaar voor scope, labels, severity/prioriteit, interpretatie en releaseadvies.
- **Google Drive Project Checklist** — actuele projectwaarheid.
- **Deze repository** — remote read-only evidencecollectie, immutable geredigeerde JSON-history en deterministische manifesttransformatie.

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

Voor `release_verification` zijn active `09` en `13` verplicht naast de vaste bronpreflight. De triggercommit mag exact één queuebestand bevatten en geen code-/workflowwijzigingen.

De workflow schrijft alleen `results/runs/<request_id>.json` terug naar Git. `results/latest.json` wordt uitsluitend tijdelijk gegenereerd in de runner/CI en is geen productie-interface.

## Browser evidence

Na `domcontentloaded`:

1. moet `body` zichtbaar zijn;
2. wordt op DOM mutation-quiescence gewacht;
3. wordt de gerenderde DOM/readiness-inventaris in geheugen opgebouwd;
4. daarna worden compacte DOM-observaties en axe uitgevoerd.

Hardening:

- publieke HTTP(S)-egress gaat via een lokale DNS-pinning proxy; validatie en daadwerkelijke connectie gebruiken dezelfde publieke IP-set;
- alleen poort 80/443 is toegestaan;
- IANA private, special-purpose, benchmark, documentation, transition, multicast en gereserveerde ranges worden geblokkeerd;
- iedere browserrequest wordt aanvullend door Playwright gecontroleerd;
- alleen `GET` en `HEAD` mogen het browserproces verlaten; achtergrond-`POST`/`PUT`/`PATCH`/`DELETE`/beacon-pogingen worden vóór netwerkverkeer geblokkeerd en geregistreerd;
- Service Workers zijn geblokkeerd zodat request interception niet wordt omzeild;
- WebSocket-egress, non-proxied WebRTC UDP en QUIC zijn geblokkeerd;
- documentnavigaties en automatische linkprobes met queryparameters worden niet gevolgd;
- interne linkchecks gebruiken maximaal zes gelijktijdige requests;
- credentials, URL-query's/fragments, e-mailadressen en veelvoorkomende token/JWT-patronen worden uit repository-evidence verwijderd;
- gevoelige responseheaders zoals cookies/authenticatie worden niet opgeslagen; CSP wordt alleen als aanwezigheid vastgelegd.

### Volledige browserartifacts

Deze repository is publiek. Daarom bewaart de productieflow **geen** screenshots, Playwright traces, volledige axe JSON of volledige DOM-snapshots en uploadt hij die ook niet als GitHub Actions artifact. De raw evidence bevat compacte geredigeerde browser-/axe-resultaten met SHA-256-binding.

`RUNTIME-BROWSER-ARTIFACT-PERSISTENCE` wordt in publieke modus `not_executed`. Wanneer volledige artifacts verplicht bewijs zijn, is een private/goedgekeurde evidence store of andere passende runtime nodig. Lokale/private testomgevingen mogen artifactpersistente expliciet opt-innen met `CHECKLIST_PERSIST_BROWSER_ARTIFACTS=1`; de publieke productieworkflow zet dit altijd op `0`.

## Formele policy — append-only

Website QA schrijft na interpretatie één nieuw bestand:

`policy/queue/<evaluation_id>.json`

De workflow bouwt en valideert daarna:

`results/formal/<evaluation_id>.json`

De formalizer kiest zelf nooit severity, status, prioriteit of releasebesluit. Hij valideert bron/schema-binding, runtime-evidence en cross-field claims. `public_test` of een willekeurige publieke staging-URL mag niet als `production_observation` worden gepresenteerd. Volledige `go` vereist onder meer een daadwerkelijk `required+passed` `RT-STAGING`-item en `staging_access=true`.

Voor cleanup, scan-fix, release verification en security retest blijven minstens twee verschillende stabiele raw rondes verplicht.

## Reproduceerbaarheid en supply chain

- Node 22 op `ubuntu-24.04`;
- `playwright` `1.62.0` en `axe-core` `4.12.1` exact gepind in `package-lock.json`;
- `npm ci --ignore-scripts --no-audit --no-fund`;
- Playwright wordt via de lokaal geïnstalleerde CLI gestart, niet via een `npx`-fallback;
- externe GitHub Actions zijn op volledige 40-teken commit-SHA's gepind;
- CI gebruikt `contents: read`; alleen de twee append-only write workflows krijgen `contents: write`;
- write-workflows accepteren uitsluitend een commit met exact één nieuw queuebestand;
- concurrerende resultwrites gebruiken begrensde rebase/push retries en schrijven unieke immutable paden.

## Automatische observaties

Onder andere publieke HTTP-status/redirects/veilige headeraanwezigheid, rendered title/meta/canonical/robots/H1/forms/alt, queryloze interne linksteekproef, robots.txt, Chromium desktop, mobiele viewportemulatie, compacte axe-observatie, `lang`, viewport-meta, console/page-errors, mixed content, WebSocket-/write-attempt guards en synthetische navigation timing.

Niet automatisch bewezen zijn onder andere keyboard/zoom, echte screenreader/AT, echte Safari/iOS/device, query-specifieke routes, WebSocket-/Service-Worker-afhankelijke functionaliteit, formulierinzending, inboxbezorging, checkout/betalingen/orders, authenticated flows, formele WCAG-conformiteit, representatieve staging/rollback, volledige browserartifactreview en echte Core Web Vitals-velddata.

## Privacygrens

De repository is publiek. Een queue-request blijft in Git-history staan en maakt dus de doel-hostnaam en het pad publiek. Gebruik deze route niet voor vertrouwelijke staginghosts, geheime/unpublished paden, persoonsgegevens of secrets. De v0.6-redactie en artifactblokkade beschermen toekomstige evidence, maar wissen eerder gecommitteerde historische artifacts niet uit oude Git-commits.

## Belangrijkste bestanden

- `SKILL.md` — project-specifiek capability-adaptercontract
- `requests/queue/` — append-only productie-requests
- `policy/queue/` — append-only policy-evaluations
- `results/runs/` — immutable geredigeerde raw JSON
- `results/formal/` — immutable formele manifests
- `test/fixtures/` — niet-productie CI-fixtures
- `src/net.js` — SSRF/public-network guard en DNS-gepinde HTTP(S)-transport
- `src/public-proxy.js` — DNS-gepinde Chromium HTTP/CONNECT-proxy
- `src/browser.js` — Playwright/axe/readiness/mutation- en netwerkguards
- `src/contracts.js` — strikte queue/request-contracten
- `src/privacy.js` — repository-evidence-redactie
- `src/concurrency.js` — begrensde read-only probes
- `src/run.js` — raw evidence
- `src/finalize.js` — raw+policy → formeel manifest
- `src/validate-result.js` — raw contract-/privacyvalidatie
- `src/validate-formal.js` + `src/validate-formal-hardening.js` — formele semantische/claimvalidatie
- `.github/workflows/` — CI, raw runner en formalizer

Drive blijft de projectwaarheid. Deze repository bepaalt nooit zelfstandig of een site `Geslaagd`, `Mislukt`, `Go` of `No-go` is.
