# Webactueel Checklist QA

Automated read-only website QA for the Webactueel `website-qa-checklist` workflow.

## What you do

Ask ChatGPT something like:

> Voer Checklist uit op https://example.com

That is all. No API key, no terminal, no tunnel, no MCP server and no extra hosting account.

## How it works

1. ChatGPT uses the already connected GitHub app.
2. ChatGPT writes the requested URL and a unique request ID to `requests/current.json`.
3. GitHub Actions automatically runs the checklist on a standard GitHub-hosted runner.
4. The workflow writes the structured result to `results/latest.json`.
5. ChatGPT reads that result and applies the installed Website QA Skill and active Checklist Drive sources to the evidence.

The repository is public and uses a standard `ubuntu-latest` GitHub-hosted runner. GitHub documents standard runners for public repositories as free.

## What it checks now

- public URL reachability and HTTP status
- HTTPS on the final URL
- HSTS, CSP, X-Content-Type-Options and Referrer-Policy observations
- title and meta description presence
- H1 presence
- missing `alt` attributes on images
- form presence without submitting anything
- broken-link sampling in `standard` and `full` modes
- explicit manual-test boundaries for keyboard, zoom, screenreader and real-device evidence
- Checklist-compatible statuses and release guidance

## Safety

The runner is read-only. It does not log in, submit forms, place orders, run payments, change content or mutate the target website. Local/private targets are rejected by the request runner.

## Repository contract

- `SKILL.md` — tells ChatGPT how to invoke the workflow.
- `requests/current.json` — the latest requested scan.
- `.github/workflows/run-checklist.yml` — automatic execution.
- `src/checklist.js` — checklist observations and labels.
- `src/run.js` — request/result adapter.
- `results/latest.json` — latest completed evidence package.

## Project truth boundary

This repository is the execution layer only. The installed `website-qa-checklist` Skill and its active registered Google Drive Checklist source set remain the policy, acceptance and release-decision truth.
