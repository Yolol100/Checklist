import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { runChecklist } from "./checklist.js";

const PORT = Number(process.env.PORT || 3000);

function createMcpServer() {
  const server = new McpServer({
    name: "webactueel-checklist-qa",
    version: "0.1.0"
  });

  server.registerTool(
    "run_checklist",
    {
      title: "Run Webactueel website checklist",
      description: "Use this when a public website URL needs a read-only Webactueel Checklist QA scan. Returns checklist-compatible evidence, findings, blocked/manual-test boundaries, and a release recommendation. Never submits forms or mutates the target.",
      inputSchema: {
        url: z.string().url().describe("Public http(s) URL to inspect."),
        level: z.enum(["quick", "standard", "full"]).default("standard").describe("quick = core page checks; standard = adds link sampling; full = larger link sample.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async ({ url, level }) => {
      try {
        const result = await runChecklist(url, level);
        return {
          structuredContent: result,
          content: [
            {
              type: "text",
              text: `Checklist uitgevoerd voor ${result.final_url}. Besluit: ${result.decision}. Geslaagd: ${result.summary.passed}; mislukt: ${result.summary.failed}; geblokkeerd: ${result.summary.blocked}; te controleren: ${result.summary.to_check}.`
            }
          ]
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          isError: true,
          structuredContent: {
            runner: "webactueel-checklist-qa",
            status: "Geblokkeerd",
            error: message,
            mutation_performed: false
          },
          content: [{ type: "text", text: `Checklist geblokkeerd: ${message}` }]
        };
      }
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.json({
    name: "Webactueel Checklist QA",
    version: "0.1.0",
    status: "ok",
    mcp_endpoint: "/mcp",
    mutation_policy: "read-only"
  });
});

app.post("/mcp", async (req, res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed" });
    }
  } finally {
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ error: "Use POST /mcp" });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ error: "Stateless endpoint; no persistent session to delete" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Webactueel Checklist QA listening on http://0.0.0.0:${PORT}/mcp`);
});
