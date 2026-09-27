'use strict';
// OPS-AGENT-CARREGA-CONECTORES-DO-ALF (27/09). Depois do CLI 2.1.281 (24/09, troca pro Opus 5.5)
// o `claude` passou a carregar os conectores do claude.ai da conta Max — Gmail, "banco mcp",
// Composio, Vercel, Apify… — em todo processo que não trava o MCP. O agente de engenharia e
// governança roda SOZINHO, com Bash na VPS, às 08:00: não pode enxergar o e-mail nem o banco do
// Alf. O relatório de 27/09 já trazia "vários conectores MCP estão sem autorização". O TOM das
// conversas sempre rodou travado (src/ai/claude.js buildArgs); o canal de ops era o lado sem irmão.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'ops-agent.js'), 'utf8');
const i = src.indexOf('const args = [');
const bloco = src.slice(i, src.indexOf('];', i) + 2);

test('ops-agent roda com MCP travado e VAZIO (nenhum conector do claude.ai)', () => {
  assert.ok(i > 0);
  assert.match(bloco, /'--strict-mcp-config'/);
  assert.match(bloco, /'--mcp-config', '\{"mcpServers":\{\}\}'/);
});

test('ops-agent desliga os conectores do claude.ai também pelo ambiente (cinto e suspensório)', () => {
  assert.match(src, /ENABLE_CLAUDEAI_MCP_SERVERS: 'false'/);
});
