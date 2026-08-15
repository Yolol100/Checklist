---
name: checklist
description: Run the Webactueel public website checklist through the connected GitHub repository when the user asks to run Checklist, website QA, a live checklist, or a release check on a public URL. Use the repository only as the automated execution layer. Keep the installed website-qa-checklist Skill and its active Google Drive sources as the policy and decision truth.
---

# Checklist

## User experience

The user only needs to ask ChatGPT to run Checklist on a public URL, optionally with `quick`, `standard` or `full`. Do not ask for an API key, terminal command, tunnel, hosting account or MCP endpoint.

## Execution

1. Resolve the public `http` or `https` target and level. Default to `standard`.
2. Reject URLs containing credentials or queryparameters because `requests/current.json` is committed to a public repository.
3. Read `requests/current.json` from `Yolol100/Checklist` through the connected GitHub app.
4. Replace it with a new request containing a unique `request_id`, normalized URL, level, current timestamp and `requested_by: "ChatGPT"`.
5. That repository write triggers the `Run Checklist` GitHub Actions workflow automatically.
6. Inspect the latest `Run Checklist` workflow run on `main` until it completes. Keep polling bounded; do not claim completion before GitHub reports success.
7. Read `results/latest.json`.
8. Accept the result only when `result.request.request_id` exactly matches the request just created.
9. Use each finding's `source_refs` to load only the relevant active/support Checklist sources from the registered Google Drive project source set.
10. Apply the installed `website-qa-checklist` Skill to interpret evidence, evidence level, open manual tests and the final claim.

## Runner capabilities

The GitHub runner may provide:

- public HTTP/redirect/header observations;
- SEO and HTML observations;
- internal-link sampling;
- Playwright Chromium evidence;
- desktop and mobile viewport emulation;
- axe-core accessibility findings;
- console/page-error and mixed-content evidence;
- lab navigation timing.

Treat these as evidence only. Do not let the runner redefine Checklist policy.

## Safety

- Public read-only observations only.
- Never submit forms, authenticate, place orders, run payments or change the target website.
- Reject local/private/reserved targets and unsafe redirects.
- Automated results do not prove keyboard, zoom, screenreader, real-device, real Safari/iOS, inbox delivery, payment or authenticated-flow behavior.
- Preserve `Geblokkeerd` or `Te controleren` where the required evidence layer is unavailable.
- Do not promote GitHub output to project truth; Drive remains authoritative.

## Output

Lead with the Checklist decision. Then state the most important failed/blocked items, what was tested, what remains untested and the highest evidence level. Use the canonical labels from the Website QA Skill.

## Failure rule

If GitHub write access or GitHub Actions is unavailable, report `Geblokkeerd` and the missing capability. Do not fall back to asking the user to create an API key, tunnel, paid QA account or separate hosting account.
