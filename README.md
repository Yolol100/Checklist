# Webactueel Checklist QA Runner

> **Platformstatus:** rollback-only · geen actieve standaardroute · geen nieuwe features

`Yolol100/Checklist` is niet langer de actieve standaardrepository voor Website QA. De actuele compatibility/runtime-route voor publieke read-only QA-evidence loopt via `Yolol100/Designchecker`. Deze repository blijft alleen tijdelijk beschikbaar als rollbackbron tijdens de migratie-/regressieperiode.

De repository is geen procescontroller en geen projectwaarheid. Google Drive bevat de actuele Project Checklist-bronnen; `website-qa-checklist` blijft de QA-owner en bepaalt het uiteindelijke Go/No-Go.

## Lifecycle

De consolidatie naar `Yolol100/Designchecker` is op controlled-runtimeniveau geaccepteerd. Daarom geldt:

- start geen nieuwe standaardruns via `Yolol100/Checklist`;
- voeg hier geen nieuwe functionaliteit toe;
- gebruik deze repository alleen voor een expliciete rollback wanneer de actieve Designchecker-route aantoonbaar faalt of moet worden teruggedraaid;
- verwijder of archiveer de rollbackbron pas na het afgesproken regressievenster en gecontroleerde readback/rollbackacceptatie.

## Actieve runtime

De actieve compatibility-route voor Website QA staat in `Yolol100/Designchecker` en gebruikt de Website-QA runtimecontracten daar. De controller mag `Yolol100/Checklist` daarom niet meer als normale QA-adapter selecteren.

De oude runner in deze repository blijft uitsluitend als rollbackreferentie bestaan. Eventuele historische runtimebranches, requests, artifacts of resultaten zijn geen actuele proceswaarheid en mogen niet als nieuwe standaardroute worden gebruikt.

## Ownership

- Procescontroller: `webactueel-workflow`
- QA-owner: `website-qa-checklist`
- Projectwaarheid: Project Checklist in Google Drive
- Actieve runtime/compatibility-route: `Yolol100/Designchecker`
- Deze repository: rollback-only

## Evidencegrenzen

Ook via de actieve Designchecker-route blijft Website QA eigenaar van acceptatie, severity en releasebesluit. Publieke browser-/axe-evidence bewijst niet automatisch volledige WCAG-conformiteit, echte Safari/iOS, assistive technology, authenticated flows, checkout/betalingen of productiegeschiktheid.

## Repository hygiene

`main` bevat alleen de generieke rollbackbron, contracten, validators en regressiefixtures die nog nodig zijn tijdens het regressievenster. Concrete targets, requests, policy-evaluaties en runresultaten horen niet als permanente operationele waarheid op `main`.

## Licentie

Deze repository bevat momenteel geen open-sourcelicentie. Hergebruik, distributie of afgeleide werken zijn niet toegestaan zonder expliciete toestemming van de rechthebbende.
