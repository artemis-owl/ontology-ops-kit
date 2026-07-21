# Serving the ontology to agents over MCP

The validated domain files are worth more if the systems acting on your data can
read them. This example serves them over the [Model Context Protocol](https://modelcontextprotocol.io/)
so an agent looks the definition up instead of inferring one.

The scenario the kit exists for: you tell an agent to "clean up test accounts."
Your ontology says `ActiveCustomer` explicitly excludes `Internal Test Accounts`,
and that test accounts live in a particular table under a particular predicate.
Without that, the agent decides for itself what a test account is, and its guess
is confident, plausible, and yours to explain afterward.

## Run it

```bash
node examples/mcp-server/server.mjs
```

It reads `domains/` by default; set `ONTOLOGY_DIR` to point elsewhere.

## Connect it to Claude Code

```bash
claude mcp add ontology -- node /absolute/path/to/ontology-ops-kit/examples/mcp-server/server.mjs
```

Or add it to any MCP client's config:

```json
{
  "mcpServers": {
    "ontology": {
      "command": "node",
      "args": ["/absolute/path/to/ontology-ops-kit/examples/mcp-server/server.mjs"]
    }
  }
}
```

## Verify it by hand

The server speaks newline-delimited JSON-RPC on stdio, so you can talk to it
without a client:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"lookup_term","arguments":{"name":"ActiveCustomer"}}}' \
  | node examples/mcp-server/server.mjs
```

## Tools

| Tool | Purpose |
| --- | --- |
| `lookup_term` | Definition, exclusions, aliases, and system of record for one term. Resolves aliases. |
| `list_terms` | Every defined term with its domain and one-line definition. |

Two deliberate choices. **Unknown terms return a refusal, not an empty result** —
the response tells the agent the term is undefined and lists what is defined, so
the failure mode is asking rather than inventing. And **exclusions are surfaced in
capital letters**, because what a term excludes is the part an agent is most
likely to get wrong.

## Where the CI loop closes

```
domain files  ->  validated in CI  ->  served over MCP  ->  read by agents at runtime
```

The definitions an agent reads are the same ones the validator enforced. That is
the whole point: no separate agent-facing copy to drift.

## Production note

This server hand-rolls JSON-RPC over stdio in about 130 lines so the protocol
surface stays readable. For real deployments use the official MCP SDK — it
handles transports, sessions, and error semantics properly. Copy the tool
contract, not the plumbing.
