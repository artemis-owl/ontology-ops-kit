#!/usr/bin/env node
// A read-only MCP server that serves your ontology to agents over stdio.
//
// The point: an agent asked to "delete test accounts" should read your definition
// of a test account instead of inferring one from training weights. This server
// makes the committed, validated domain files the thing it reads.
//
// Zero dependencies beyond the kit itself — a hand-rolled JSON-RPC loop over stdio,
// so you can read the whole protocol surface in one sitting. For production, use
// the official MCP SDK; the tool contract below is the part worth copying.

import { loadDomains } from "../../lib/load.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOMAIN_DIR = process.env.ONTOLOGY_DIR ?? path.join(HERE, "..", "..", "domains");
const PROTOCOL_VERSION = "2025-06-18";

const domains = (await loadDomains(DOMAIN_DIR)).filter((d) => d.doc && !d.parseError);
const terms = new Map();
for (const { doc } of domains) {
  for (const term of doc.terms ?? []) {
    terms.set(term.name.toLowerCase(), { ...term, domain: doc.metadata?.name, version: doc.metadata?.version, owner: doc.metadata?.owner });
  }
}

const TOOLS = [
  {
    name: "lookup_term",
    description:
      "Get the authoritative definition of a business term, including what it excludes and its system of record. Call this before acting on any term whose meaning is organization-specific.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Term name or a known alias, e.g. ActiveCustomer." } },
      required: ["name"],
    },
  },
  {
    name: "list_terms",
    description: "List every defined term with its domain and one-line definition.",
    inputSchema: { type: "object", properties: {} },
  },
];

function lookupTerm({ name }) {
  const key = String(name ?? "").toLowerCase();
  let hit = terms.get(key);
  if (!hit) {
    for (const term of terms.values()) {
      if ((term.aliases ?? []).some((a) => a.toLowerCase() === key)) {
        hit = term;
        break;
      }
    }
  }
  if (!hit) {
    const known = [...terms.values()].map((t) => t.name).join(", ");
    return `No definition for "${name}". This term is not in the ontology — do not guess at its meaning. Defined terms: ${known}`;
  }

  const lines = [
    `${hit.name} (${hit.domain} v${hit.version}, owned by ${hit.owner})`,
    "",
    hit.summary,
  ];
  if (hit.exclusions?.length) lines.push("", `Explicitly EXCLUDES: ${hit.exclusions.join("; ")}`);
  if (hit.aliases?.length) lines.push("", `Also called: ${hit.aliases.join("; ")}`);
  if (hit.mappings?.primarySource) {
    const filter = hit.mappings.statusColumn ? ` where ${hit.mappings.statusColumn}` : "";
    lines.push("", `System of record: ${hit.mappings.primarySource}${filter}`);
  }
  if (hit.notes) lines.push("", `Notes: ${hit.notes}`);
  return lines.join("\n");
}

const listTerms = () =>
  [...terms.values()].map((t) => `${t.name} (${t.domain}): ${t.summary}`).join("\n") || "No terms defined.";

function handle(request) {
  const { id, method, params } = request;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "ontology-ops-kit", version: "0.1.0" },
      });
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const { name, arguments: args = {} } = params ?? {};
      if (name === "lookup_term") return reply({ content: [{ type: "text", text: lookupTerm(args) }] });
      if (name === "list_terms") return reply({ content: [{ type: "text", text: listTerms() }] });
      return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name}` } };
    }
    default:
      if (method?.startsWith("notifications/")) return null; // notifications get no reply
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let response;
    try {
      response = handle(JSON.parse(line));
    } catch (err) {
      response = { jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err.message}` } };
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  }
});

process.stderr.write(`ontology-ops MCP server ready — ${terms.size} terms from ${DOMAIN_DIR}\n`);
