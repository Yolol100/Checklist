# Webactueel Checklist QA

Specialized read-only QA runner for the Webactueel `website-qa-checklist` workflow.

This repository is intended to expose public website checks to ChatGPT through a custom MCP app. The app does not replace the Checklist Skill or its active Google Drive project sources; it supplies runtime evidence that those sources can evaluate.

## Initial scope

- Public URL reachability and HTTP status
- HTTPS/TLS presence
- Security header observations
- Basic HTML/SEO signals
- Broken-link sampling
- Accessibility-oriented DOM checks
- Performance timing observations
- Explicit manual-test boundaries
- Checklist-compatible statuses and release guidance

## Safety

Version 0.1 is read-only. It must not submit forms, place orders, authenticate, change content, or mutate production systems.

## Planned ChatGPT interface

Primary MCP tool: `run_checklist`

Input:
- `url`
- `level`: `quick`, `standard`, or `full`

Output:
- checklist findings
- evidence records
- status labels
- blocked/manual-test items
- release recommendation

## Project truth

The active Checklist project sources remain in Google Drive. This repository contains executable adapters and mappings only.
