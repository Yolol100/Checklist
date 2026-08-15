# Webactueel Checklist QA

Gratis, read-only website-QA die vanuit ChatGPT Web via de bestaande GitHub-koppeling kan worden gestart.

## Gebruik vanuit ChatGPT

Vraag bijvoorbeeld:

> Voer Checklist standaard uit op https://example.com

of:

> Voer Checklist volledig uit op https://example.com

Je hebt voor deze runner geen extra QA-account, API-key, MCP-server, tunnel of hostingdienst nodig. De bestaande GitHub-koppeling is de uitvoeringsroute.

## Werking

1. ChatGPT schrijft een unieke scanrequest naar `requests/current.json`.
2. GitHub Actions start automatisch de `Run Checklist` workflow.
3. De runner voert alleen publieke, read-only observaties uit.
4. Het bewijs wordt opgeslagen in `results/latest.json`.
5. ChatGPT accepteert alleen het resultaat met hetzelfde `request_id`.
6. De geïnstalleerde `website-qa-checklist` Skill en de actieve Checklist-bronnen in Google Drive interpreteren het bewijs en bepalen de uiteindelijke QA/releaseclaim.

## Automatische checks

- publieke bereikbaarheid, statuscodes en redirects
- HTTPS
- HSTS, CSP, X-Content-Type-Options, Referrer-Policy en Permissions-Policy
- title, meta description, canonical en meta robots/noindex-observatie
- H1 en ontbrekende `alt`-attributen
- interne linksteekproef
- robots.txt-observatie
- formulierdetectie zonder iets te versturen
- Chromium via Playwright
- desktop + mobiele viewportemulatie bij `standard`/`full`
- axe-core toegankelijkheidsscan
- `lang` en viewport-meta
- console/page-errors
- mixed-content subrequests
- browserlab navigation timing

## Bewijsgrenzen

De runner verklaart onderstaande onderdelen bewust niet automatisch geslaagd:

- keyboard- en zoomtests
- echte screenreader/assistive-technologytest
- echte iPhone/iPad of echte Safari/iOS
- echte inboxbezorging
- formulierinzendingen
- checkout, betalingen en orders
- ingelogde flows
- formele WCAG-conformiteit
- echte Core Web Vitals-velddata

Die onderdelen blijven `Geblokkeerd` of `Te controleren` wanneer de Checklist-bronnen dat bewijs vereisen.

## Veiligheid

- Alleen `http`/`https`.
- Lokale/private/gereserveerde IP-ranges worden geblokkeerd.
- Redirects worden opnieuw gevalideerd.
- URL's met credentials worden geweigerd.
- Scanrequests met queryparameters worden geweigerd omdat deze repository publiek is en querystrings tokens/persoonsgegevens kunnen bevatten.
- De runner logt niet in, verzendt geen formulieren en wijzigt de targetsite niet.
- HTML-responses worden begrensd om onnodig grote downloads te voorkomen.

## Checklist-bronnen

Findings bevatten `source_refs` naar de relevante canonieke Checklist-bronnen, bijvoorbeeld:

- `02-frontend-responsive-accessibility.md`
- `03-formulieren-email-en-crm.md`
- `04-seo-indexatie-en-migratie.md`
- `06-wordpress-elementor-en-performance.md`
- `08-security-en-technische-risicos.md`
- `11-evidence-levels-runtime-matrix.md`
- `82-tool-en-browsermatrix.md`
- `88-playwright-axe-adapter.md`

Deze bestanden worden niet gekopieerd naar GitHub. Google Drive blijft de projectwaarheid.

## Repository

- `SKILL.md` - ChatGPT-invocatiecontract
- `agents/openai.yaml` - korte metadata
- `requests/current.json` - laatste scanrequest
- `.github/workflows/run-checklist.yml` - automatische uitvoering
- `.github/workflows/ci.yml` - syntax- en browser-smoketest
- `src/net.js` - publieke netwerk/SSRF-beveiliging
- `src/browser.js` - Playwright + axe adapter
- `src/checklist.js` - checks, labels en evidence
- `src/run.js` - request/result adapter
- `results/latest.json` - laatste afgeronde evidence

## Projectwaarheid

Deze repository is alleen de uitvoeringslaag. De geïnstalleerde `website-qa-checklist` Skill en de actieve geregistreerde Checklist-bronnen in Google Drive blijven leidend voor scope, prioriteit, bewijsvereisten en eindbesluit.
