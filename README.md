# Webactueel Checklist QA Runner

> **Portfoliostatus:** Actief ondersteunend · Webactueel QA-evidencerunner

**Rol in het platform:** [Checklist](https://github.com/Yolol100/Checklist) voert begrensde read-only QA uit voor `website-qa-checklist`. Voor browser-, accessibility-, performance- of visual-regressie-evidence kan de owning workflow [Designchecker](https://github.com/Yolol100/Designchecker) inzetten. Het uiteindelijke Go/No-Go blijft bij de QA-owner.

Generieke publieke read-only QA-evidencerunner voor Project Checklist. De `website-qa-checklist` Skill blijft QA-eigenaar; Google Drive blijft projectwaarheid; deze repository levert uitsluitend reproduceerbare evidence en manifesttransformatie.

## Repository hygiene

`main` bevat alleen de generieke harness, contracten, validators en regressiefixtures. Concrete targets, requests, policy-evaluaties en runresultaten worden niet permanent opgeslagen.

- Requeststate leeft tijdelijk onder `requests/queue/` op een `runtime/**`-branch.
- Raw evidence leeft tijdelijk onder `results/runs/` op die runtimebranch en als GitHub Actions-artifact.
- Policy-evaluaties leven tijdelijk onder `policy/queue/` op die runtimebranch.
- Formele manifests worden als GitHub Actions-artifact gepubliceerd; ze worden niet naar `main` gecommit.
- Na readback/closure wordt de tijdelijke runtimebranch verwijderd.
- `test/fixtures/` blijft toegestaan: dit zijn generieke regressiefixtures die de harness zelf bewijzen.

## Raw run

Maak vanaf de actuele `main` een tijdelijke `runtime/**`-branch en commit daarin precies één nieuw `requests/queue/<request_id>.json`-bestand. De workflow valideert dat de triggercommit uitsluitend dat request bevat, voert de bestaande read-only browser/netwerkcontroles uit, valideert het raw evidence-contract en publiceert `results/runs/<request_id>.json` als artifact.

Voor een formele evaluatie kan de controller het gevalideerde raw artifact op dezelfde tijdelijke runtimebranch plaatsen. Commit daarna precies één `policy/queue/<evaluation_id>.json`; de finalizer leest de benodigde raw rondes, valideert Evidence Manifest 3.0 en publiceert het formele manifest als artifact.

## Veiligheidsgrenzen

- Alleen publieke HTTP(S)-doelen; SSRF/private/special-purpose ranges worden geblokkeerd.
- Browsernetwerk blijft GET/HEAD-only en gebruikt de bestaande DNS-pinning/proxyguards.
- De publieke runner bewaart geen volledige screenshots, traces, DOM-snapshots of volledige axe-output.
- Automatische evidence bewijst geen volledige WCAG-conformiteit, echte Safari/iOS, echte assistive technology, authenticated flows, checkout/betalingen of representatieve staging/rollback.
- Go/No-Go blijft een beslissing van `website-qa-checklist` op basis van de vereiste evidence.

## Reproduceerbaarheid

Node/toolversies, lockfile-installatie, vastgepinde externe Actions, netwerkguards, privacyredactie, evidence-contracten en de formele semantische validators blijven onderdeel van de generieke harness.
