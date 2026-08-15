---
name: checklist
description: Run the Webactueel public website checklist through the connected GitHub repository when the user asks to run Checklist, website QA, a live checklist, or a release check on a URL. Use the repository only as the automated execution layer. Keep the installed website-qa-checklist Skill and its active Google Drive sources as the policy and decision truth.
---

# Checklist

## User experience

The user only needs to ask ChatGPT to run Checklist on a public URL. Do not ask the user for an API key, terminal command, tunnel, hosting account, MCP endpoint or manual GitHub action.

## Execution

1. Resolve the public `http` or `https` target and level: `quick`, `standard` or `full`. Default to `standard` when no level is specified.
2. Read `requests/current.json` from `Yolol100/Checklist` through the connected GitHub app.
3. Replace it with a new request containing a unique `request_id`, the URL, level, current timestamp and `requested_by: "ChatGPT"`.
4. That repository write triggers the `Run Checklist` GitHub Actions workflow automatically.
5. Inspect the latest `Run Checklist` workflow run on `main` until it completes. Keep polling bounded; do not claim completion before GitHub reports success.
6. Read `results/latest.json` from the repository.
7. Accept the result only when `result.request.request_id` exactly matches the request just created. If it does not, treat the run as not yet complete and re-read after the workflow finishes.
8. Apply the installed `website-qa-checklist` Skill and active registered Checklist Drive sources to interpret the evidence and final claim.

## Safety

- Public read-only observations only.
- Never submit forms, authenticate, place orders, run payments or change the target website.
- Reject local/private targets.
- Automated results do not prove keyboard, zoom, screenreader, real-device, real Safari/iOS, inbox delivery, payment or authenticated-flow behavior.
- Preserve `Geblokkeerd` or `Te controleren` where the required evidence layer is unavailable.

## Output

Lead with the Checklist decision. Then state the most important failed/blocked items, what was tested, what remains untested and the evidence level. Use the canonical labels from the Website QA Skill.

## Failure rule

If GitHub write access or GitHub Actions is unavailable, report `Geblokkeerd` and the missing capability. Do not fall back to asking the user to run Bash, create an API key, create a tunnel, host an MCP server or open another account.
