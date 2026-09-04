# Webactueel Checklist QA Runner

> **Platformstatus:** migratiebron · tijdelijk actief ondersteunend · geen nieuwe features

`Checklist` blijft tijdelijk beschikbaar als publieke read-only QA-evidencerunner voor `website-qa-checklist`. De repository is geen procescontroller en geen projectwaarheid. Google Drive bevat de actuele Project Checklist-bronnen; `website-qa-checklist` blijft de QA-owner en bepaalt het uiteindelijke Go/No-Go.

## Lifecycle

De beoogde consolidatieroute is:

`Checklist -> Designchecker`

Nieuwe functionaliteit hoort daarom niet meer in deze repository. Bestaande runtimecapaciteit blijft alleen beschikbaar zolang de vereiste evidence-/runtimepariteit nog niet aantoonbaar door `Yolol100/Designchecker` is overgenomen. Verwijdering of archivering is pas geldig na bewezen pariteit, readback en rollback/degradatiecontrole.

## Huidige rol

De bestaande Orchestrator-adapter mag deze repository nog gebruiken voor begrensde read-only QA-runs. De runner:

- accepteert alleen publieke HTTP(S)-doelen;
- houdt request- en resultstate op tijdelijke runtimebranches/artifacts;
- levert reproduceerbare QA-evidence en manifesttransformatie;
- bewaart geen concrete klanttargets of permanente runstate op `main`;
- bewijst niet automatisch volledige WCAG-conformiteit, echte Safari/iOS, assistive technology, authenticated flows, checkout/betalingen of productiegeschiktheid.

Voor browser-, accessibility-, performance- en visual-regressie-evidence heeft `Designchecker` de voorkeur zodra die capability de benodigde evidence-class aantoonbaar volledig afdekt.

## Ownership

- Procescontroller: `webactueel-workflow`
- QA-owner: `website-qa-checklist`
- Projectwaarheid: Project Checklist in Google Drive
- Consolidatiedoel: `Yolol100/Designchecker`

## Repository hygiene

`main` bevat alleen de generieke harness, contracten, validators en regressiefixtures. Concrete targets, requests, policy-evaluaties en runresultaten horen uitsluitend in tijdelijke runtime-state/artifacts en worden na closure opgeruimd.

## Licentie

Deze repository bevat momenteel geen open-sourcelicentie. Hergebruik, distributie of afgeleide werken zijn niet toegestaan zonder expliciete toestemming van de rechthebbende.
