# Webactueel Checklist QA

Read-only MCP QA runner for the Webactueel `website-qa-checklist` workflow.

The app supplies runtime evidence. It does **not** replace the Checklist Skill or the active Google Drive project sources; those remain the project truth and decision layer.

## What version 0.1 checks

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

Version 0.1 is read-only. It does not log in, submit forms, place orders, run payments, change content or mutate a target website.

## MCP tool

### `run_checklist`

Input:

- `url`: public `http` or `https` URL
- `level`: `quick`, `standard`, or `full`

Output includes:

- `Geslaagd`, `Mislukt`, `Geblokkeerd`, `Te controleren`, `Niet van toepassing`
- `Kritiek`, `Hoog`, `Midden`, `Laag`
- evidence per finding
- limitations/manual-test boundaries
- `Source GO`, `Conditional GO`, `Go na fixes`, or `No-go`

## Run locally

Requirements: Node.js 20+.

```bash
npm install
npm run check
npm start
```

The MCP endpoint is then:

```text
http://localhost:3000/mcp
```

No OpenAI API key or external QA API key is used.

## Expose it temporarily without another account

For development/testing only, Cloudflare Quick Tunnels can expose localhost without a Cloudflare account:

```bash
cloudflared tunnel --url http://localhost:3000
```

or with Wrangler:

```bash
npx wrangler tunnel quick-start http://localhost:3000
```

Copy the generated `https://...trycloudflare.com` URL and append `/mcp`.

Quick Tunnel URLs are temporary and change after restart. They are for testing, not production hosting.

## Connect to ChatGPT Web

1. Start the MCP server.
2. Start the temporary HTTPS tunnel.
3. Enable ChatGPT Developer Mode if your plan/workspace supports custom MCP apps.
4. In ChatGPT Web open **Settings → Apps → Create**.
5. Use the generated HTTPS URL ending in `/mcp`.
6. Choose no authentication for this local development version.
7. Scan tools and confirm that `run_checklist` appears.
8. Add the app, then use it in a chat.

Example prompt:

```text
Gebruik Checklist en voer een standaard QA-check uit op https://example.com. Pas daarna de Website QA Skill en actieve Checklist-bronnen toe op de resultaten.
```

## Architecture

```text
ChatGPT Web
  -> custom MCP app
  -> run_checklist
  -> public read-only observations
  -> structured Checklist evidence
  -> Website QA Skill + active Drive sources
  -> final QA/release decision
```

## Project truth boundary

Keep executable adapters and mappings in this repository. Keep active project policy/source truth in the registered Google Drive Checklist source set. Do not silently duplicate or fork those sources here.

## Next adapters

The runner is intentionally small first. Logical next additions are Playwright + axe, Lighthouse, HTML validation and TLS/header adapters, while preserving the same evidence schema and manual-test boundaries.
