# LA Report Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar o TOM e o PWA do LA Organizer ao banco LA Report (cross-project Supabase) para que o Rafinha possa consultar e popular inventário, salas e lojinha via WhatsApp e PWA.

**Architecture:** TOM importa um cliente Supabase cross-project com service_role_key do LA Report. Toda escrita usa esse cliente; PWA consome via endpoints proxy `/internal/lareport/*` do TOM (browser nunca vê service_role). Marker JSON `<<INVENTORY_ACTION>>` e slash commands `/inv`/`/loja` ambos chamam o mesmo `inventario-service`.

**Tech Stack:** Node.js (TOM, PM2 na VPS) + Express internal-api + Supabase client cross-project + React 18 + TypeScript + Vite + TanStack Query + Tailwind.

**Spec:** `docs/superpowers/specs/2026-05-16-la-report-integration-design.md`

**Project realities:**
- **No tests**: validação = `npx tsc --noEmit`, `npx vite build`, `node --check`, screenshot Simple Browser via `mcp__Claude_Preview`.
- **No per-task commits**: auto-deploy hook commita tudo no fim do turno.
- **No worktree**: trabalho direto em `D:\la-organizer\_remote\`.
- **Deploy TOM**: SCP de `_remote/src/` e `_remote/skills/` para `tom:/opt/LA-Organizer/` + `pm2 restart tom`.

---

## File Structure

### Novos arquivos
```
_remote/src/services/la-report-client.js               (cliente cross-project)
_remote/src/services/inventario-service.js              (todas queries+writes ao LA Report)
_remote/src/services/inventario-validators.js           (JSON schema validators)
_remote/src/rituals/inventario-alertas.js               (3 crons + queue insert)
_remote/skills/inventario.md                            (skill com triggers + exemplos)
_remote/skills/pesquisa-preco.md                        (skill web search preço)

_remote/web/src/lib/lareport-types.ts                   (tipos espelhando schema LA Report)
_remote/web/src/lib/lareport.ts                         (fetch HTTP nos endpoints internal-api)
_remote/web/src/hooks/useLaReport.ts                    (6 hooks TanStack)
_remote/web/src/screens/inventario/ListaPage.tsx
_remote/web/src/screens/inventario/SalaPage.tsx
_remote/web/src/screens/inventario/LojaPage.tsx
_remote/web/src/screens/inventario/components/UnidadeTabs.tsx
_remote/web/src/screens/inventario/components/SalaCard.tsx
_remote/web/src/screens/inventario/components/ItemCard.tsx
_remote/web/src/screens/inventario/components/ProdutoCard.tsx
```

### Arquivos modificados
```
_remote/web/src/App.tsx                       (+ 3 rotas gated)
_remote/web/src/screens/Mais.tsx              (+ link 📦 Inventário)
_remote/src/internal-api.js                   (+ 5 endpoints /internal/lareport/*)
_remote/src/engine.js                         (+ handlers /inv + /loja + marker)
_remote/src/prompts/system.js                 (+ skill detection contextual)
_remote/src/rituals/dispatcher.js             (+ 1 cron seg 09h)

VPS:
/opt/LA-Organizer/.env                        (+ LA_REPORT_SUPABASE_URL + LA_REPORT_SERVICE_ROLE_KEY)
```

---

## Task 1: Setup do ambiente VPS + dependência

**Files:**
- Modify (VPS): `/opt/LA-Organizer/.env`
- Modify (VPS): `/opt/LA-Organizer/package.json` (verificar @supabase/supabase-js)

- [ ] **Step 1: Confirmar que `@supabase/supabase-js` já está instalado no TOM**

```bash
ssh tom "cd /opt/LA-Organizer && node -e \"console.log(require('@supabase/supabase-js').createClient ? 'OK' : 'MISSING')\""
```
Expected: `OK`. Se `MISSING`, rodar `ssh tom "cd /opt/LA-Organizer && npm install @supabase/supabase-js"`.

- [ ] **Step 2: Adicionar credenciais LA Report ao .env da VPS**

```bash
ssh tom 'grep -q "^LA_REPORT_SUPABASE_URL=" /opt/LA-Organizer/.env || echo "LA_REPORT_SUPABASE_URL=https://ouqwbbermlzqqvtqwlul.supabase.co" >> /opt/LA-Organizer/.env'
ssh tom 'grep -q "^LA_REPORT_SERVICE_ROLE_KEY=" /opt/LA-Organizer/.env && echo "SERVICE_KEY já configurada" || echo "FALTA: solicitar service_role_key ao Hugo e adicionar manualmente"'
```

**Importante:** Se `LA_REPORT_SERVICE_ROLE_KEY` ainda não está configurada, pedir ao Owner (Luciano) pra adicionar manualmente via `ssh tom 'echo "LA_REPORT_SERVICE_ROLE_KEY=<KEY>" >> /opt/LA-Organizer/.env'` antes de seguir. **Não comitar a key em nenhum arquivo.**

- [ ] **Step 3: Validar ambiente**

```bash
ssh tom 'cd /opt/LA-Organizer && node -e "require(\"dotenv\").config(); console.log(process.env.LA_REPORT_SUPABASE_URL ? \"URL_OK\" : \"URL_MISSING\", process.env.LA_REPORT_SERVICE_ROLE_KEY ? \"KEY_OK\" : \"KEY_MISSING\")"'
```
Expected: `URL_OK KEY_OK`. Se algo missing, parar e avisar Owner.

---

## Task 2: `services/la-report-client.js`

**Files:**
- Create: `_remote/src/services/la-report-client.js`

- [ ] **Step 1: Escrever o cliente**

```js
// _remote/src/services/la-report-client.js
// Cliente Supabase cross-project para o banco do LA Report.
// CRÍTICO: este é o ÚNICO arquivo que importa @supabase/supabase-js com as credenciais LA_REPORT_*.
// Todos os outros módulos devem importar `laReportClient` daqui — NUNCA criar outro client.

const { createClient } = require('@supabase/supabase-js');

const url = process.env.LA_REPORT_SUPABASE_URL;
const key = process.env.LA_REPORT_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.warn('[la-report-client] credenciais LA Report ausentes — feature inventário desabilitada');
}

const laReportClient = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder-key',
  {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: 'public' },
  }
);

function isLaReportConfigured() {
  return !!(url && key);
}

module.exports = { laReportClient, isLaReportConfigured };
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/services/la-report-client.js
```
Expected: sem output (clean).

- [ ] **Step 3: Deploy + smoke test**

```bash
ssh tom "mkdir -p /opt/LA-Organizer/src/services"
scp D:/la-organizer/_remote/src/services/la-report-client.js tom:/opt/LA-Organizer/src/services/
ssh tom 'cd /opt/LA-Organizer && node -e "
require(\"dotenv\").config();
const { laReportClient, isLaReportConfigured } = require(\"./src/services/la-report-client\");
console.log(\"configured:\", isLaReportConfigured());
laReportClient.from(\"unidades\").select(\"id, nome\").then(({data, error}) => {
  if (error) { console.error(\"ERR:\", error.message); process.exit(1); }
  console.log(\"unidades:\", data.length, data.map(u => u.nome).join(\", \"));
});
"'
```
Expected: `configured: true` + `unidades: 3 Barra, Campo Grande, Recreio`. Se erro, parar e debugar.

---

## Task 3: `services/inventario-validators.js`

**Files:**
- Create: `_remote/src/services/inventario-validators.js`

- [ ] **Step 1: Escrever validators**

```js
// _remote/src/services/inventario-validators.js
// JSON schema validation para INVENTORY_ACTION marker payloads.
// Mantém a validação separada do service pra reusar em testes/diagnóstico.

const VALID_ACTIONS = ['add_item', 'move_item', 'maintenance', 'shop_movement', 'query_room', 'query_shop', 'query_rooms'];
const VALID_CATEGORIAS = ['instrumento', 'eletronico', 'mobilia', 'consumivel', 'outros'];
const VALID_CONDICOES = ['novo', 'bom', 'regular', 'ruim'];
const VALID_STATUS = ['ativo', 'manutencao', 'baixa', 'inativo'];
const VALID_MOV_TIPOS = ['entrada', 'saida', 'transferencia', 'baixa', 'manutencao'];

function validateAction(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { ok: false, errors: ['payload_invalido'] };
  }
  if (!VALID_ACTIONS.includes(payload.action)) {
    errors.push(`action_invalida: ${payload.action}`);
  }
  if (!payload.params || typeof payload.params !== 'object') {
    errors.push('params_ausente');
  }
  return { ok: errors.length === 0, errors };
}

function validateAddItem(p) {
  const errors = [];
  if (!p.nome || typeof p.nome !== 'string' || p.nome.trim().length < 3) errors.push('nome_invalido');
  if (!p.sala_id && !p.sala_nome) errors.push('sala_obrigatoria');
  if (!p.unidade_id && !p.unidade_nome) errors.push('unidade_obrigatoria');
  if (p.categoria && !VALID_CATEGORIAS.includes(p.categoria)) errors.push(`categoria_invalida: ${p.categoria}`);
  if (p.condicao && !VALID_CONDICOES.includes(p.condicao)) errors.push(`condicao_invalida: ${p.condicao}`);
  if (p.quantidade !== undefined && (!Number.isInteger(p.quantidade) || p.quantidade < 1)) errors.push('quantidade_invalida');
  if (p.valor_compra !== undefined && (typeof p.valor_compra !== 'number' || p.valor_compra < 0)) errors.push('valor_compra_invalido');
  return { ok: errors.length === 0, errors };
}

function validateMoveItem(p) {
  const errors = [];
  if (!p.item_id && !p.item_nome) errors.push('item_obrigatorio');
  if (!VALID_MOV_TIPOS.includes(p.tipo)) errors.push(`tipo_invalido: ${p.tipo}`);
  if (p.tipo === 'transferencia' && !p.sala_destino_id && !p.sala_destino_nome) errors.push('destino_obrigatorio_para_transferencia');
  return { ok: errors.length === 0, errors };
}

function validateMaintenance(p) {
  const errors = [];
  if (!p.item_id && !p.item_nome) errors.push('item_obrigatorio');
  if (!p.descricao || p.descricao.trim().length < 5) errors.push('descricao_obrigatoria');
  return { ok: errors.length === 0, errors };
}

function validateShopMovement(p) {
  const errors = [];
  if (!p.produto_id && !p.produto_nome) errors.push('produto_obrigatorio');
  if (!p.unidade_id && !p.unidade_nome) errors.push('unidade_obrigatoria');
  if (!Number.isInteger(p.quantidade) || p.quantidade === 0) errors.push('quantidade_invalida');
  if (!['entrada', 'saida'].includes(p.tipo)) errors.push(`tipo_invalido: ${p.tipo}`);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  VALID_ACTIONS, VALID_CATEGORIAS, VALID_CONDICOES, VALID_STATUS, VALID_MOV_TIPOS,
  validateAction, validateAddItem, validateMoveItem, validateMaintenance, validateShopMovement,
};
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/services/inventario-validators.js
```

---

## Task 4: `services/inventario-service.js` — leitura

**Files:**
- Create: `_remote/src/services/inventario-service.js`

- [ ] **Step 1: Escrever funções de leitura**

```js
// _remote/src/services/inventario-service.js
// Único módulo que orquestra queries+writes contra o LA Report.
// Engine, internal-api e rituals chamam funções daqui — nunca importam laReportClient diretamente.

const { laReportClient } = require('./la-report-client');

function viaTomLabel(nome) {
  return `via TOM por ${nome || 'usuário desconhecido'}`;
}

function withViaTom(observacoes, nome) {
  const tag = viaTomLabel(nome);
  if (!observacoes) return tag;
  return `${tag} — ${observacoes}`;
}

// ─── LEITURA ─────────────────────────────────────────────────

async function listarUnidades() {
  const { data, error } = await laReportClient
    .from('unidades').select('id, nome').order('nome');
  if (error) throw error;
  return data || [];
}

async function listarSalasPorUnidade(unidadeId) {
  const { data, error } = await laReportClient
    .from('salas')
    .select('id, nome, tipo_sala, capacidade_maxima, recursos, codigo, ativo')
    .eq('unidade_id', unidadeId)
    .eq('ativo', true)
    .order('nome');
  if (error) throw error;
  // Anexa contagem de itens em paralelo
  const ids = (data || []).map(s => s.id);
  if (ids.length === 0) return [];
  const { data: counts } = await laReportClient
    .from('inventario')
    .select('sala_id', { count: 'exact', head: false })
    .in('sala_id', ids);
  const countMap = new Map();
  for (const row of counts || []) {
    countMap.set(row.sala_id, (countMap.get(row.sala_id) || 0) + 1);
  }
  return (data || []).map(s => ({ ...s, itens_count: countMap.get(s.id) || 0 }));
}

async function buscarSalaPorNome(nome, unidadeId) {
  let query = laReportClient
    .from('salas')
    .select('id, nome, tipo_sala, unidade_id, recursos, ativo')
    .ilike('nome', `%${nome}%`)
    .eq('ativo', true);
  if (unidadeId) query = query.eq('unidade_id', unidadeId);
  const { data, error } = await query.limit(5);
  if (error) throw error;
  return data || [];
}

async function detalheSala(salaId) {
  const [salaRes, itensRes, movRes, manutRes] = await Promise.all([
    laReportClient.from('salas').select('*, unidades(nome)').eq('id', salaId).single(),
    laReportClient.from('inventario').select('*').eq('sala_id', salaId).eq('ativo', true).order('nome'),
    laReportClient.from('inventario_movimentacoes')
      .select('*, inventario(nome, codigo_patrimonio)')
      .or(`sala_origem_id.eq.${salaId},sala_destino_id.eq.${salaId}`)
      .order('data_movimentacao', { ascending: false }).limit(20),
    laReportClient.from('inventario_manutencoes')
      .select('*, inventario(nome, codigo_patrimonio, sala_id)')
      .order('data_manutencao', { ascending: false }).limit(20),
  ]);
  if (salaRes.error) throw salaRes.error;
  // Filtra manutenções: só as cujo item está nesta sala
  const manut = (manutRes.data || []).filter(m => m.inventario?.sala_id === salaId);
  return {
    sala: salaRes.data,
    itens: itensRes.data || [],
    movimentacoes: movRes.data || [],
    manutencoes: manut,
  };
}

async function listarLojaPorUnidade(unidadeId) {
  const { data: produtos, error: e1 } = await laReportClient
    .from('loja_produtos')
    .select('id, nome, sku, preco, custo, estoque_minimo, foto_url, disponivel_whatsapp, ativo, loja_categorias(nome, icone)')
    .eq('ativo', true)
    .order('nome');
  if (e1) throw e1;
  const ids = (produtos || []).map(p => p.id);
  let estoqueMap = new Map();
  if (ids.length && unidadeId) {
    const { data: estoque } = await laReportClient
      .from('loja_estoque')
      .select('produto_id, quantidade')
      .eq('unidade_id', unidadeId)
      .in('produto_id', ids);
    for (const e of estoque || []) {
      estoqueMap.set(e.produto_id, (estoqueMap.get(e.produto_id) || 0) + e.quantidade);
    }
  }
  return (produtos || []).map(p => {
    const qtd = estoqueMap.get(p.id) || 0;
    return {
      ...p,
      estoque_atual: qtd,
      abaixo_minimo: p.estoque_minimo > 0 && qtd < p.estoque_minimo,
      zerado: qtd === 0,
    };
  });
}

async function buscarProdutoPorNome(nome) {
  const { data, error } = await laReportClient
    .from('loja_produtos').select('id, nome, sku, preco, custo, estoque_minimo')
    .ilike('nome', `%${nome}%`).eq('ativo', true).limit(5);
  if (error) throw error;
  return data || [];
}

async function listarEstoqueBaixo(unidadeId) {
  const lista = await listarLojaPorUnidade(unidadeId);
  return lista.filter(p => p.abaixo_minimo || p.zerado);
}

async function listarManutencoesPendentes(diasMin = 14) {
  const cutoffIso = new Date(Date.now() - diasMin * 86400000).toISOString();
  const { data, error } = await laReportClient
    .from('inventario_manutencoes')
    .select('id, item_id, tipo, descricao, data_manutencao, responsavel, custo, inventario(nome, codigo_patrimonio, sala_id, salas(nome, unidade_id, unidades(nome)))')
    .lt('data_manutencao', cutoffIso)
    .order('data_manutencao');
  if (error) throw error;
  return data || [];
}

async function listarRevisoesProgramadas(diasAtePrazo = 7) {
  const ate = new Date(Date.now() + diasAtePrazo * 86400000).toISOString().slice(0, 10);
  const hoje = new Date().toISOString().slice(0, 10);
  const { data, error } = await laReportClient
    .from('inventario')
    .select('id, nome, codigo_patrimonio, proxima_revisao, sala_id, salas(nome, unidade_id, unidades(nome))')
    .gte('proxima_revisao', hoje).lte('proxima_revisao', ate)
    .eq('ativo', true).order('proxima_revisao');
  if (error) throw error;
  return data || [];
}

module.exports = {
  viaTomLabel, withViaTom,
  listarUnidades, listarSalasPorUnidade, buscarSalaPorNome, detalheSala,
  listarLojaPorUnidade, buscarProdutoPorNome,
  listarEstoqueBaixo, listarManutencoesPendentes, listarRevisoesProgramadas,
};
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/services/inventario-service.js
```

- [ ] **Step 3: Smoke test cross-project**

```bash
scp D:/la-organizer/_remote/src/services/inventario-service.js tom:/opt/LA-Organizer/src/services/
ssh tom 'cd /opt/LA-Organizer && node -e "
require(\"dotenv\").config();
const svc = require(\"./src/services/inventario-service\");
(async () => {
  const u = await svc.listarUnidades();
  console.log(\"unidades:\", u.length);
  const barra = u.find(x => x.nome === \"Barra\");
  if (!barra) { console.error(\"Barra não encontrada\"); process.exit(1); }
  const salas = await svc.listarSalasPorUnidade(barra.id);
  console.log(\"salas Barra:\", salas.length, \"primeira:\", salas[0]?.nome);
  const hendrix = await svc.buscarSalaPorNome(\"Hendrix\", barra.id);
  console.log(\"fuzzy Hendrix:\", hendrix.length, hendrix[0]?.nome);
})();
"'
```
Expected: `unidades: 3`, `salas Barra: 8`, `fuzzy Hendrix: 1 Hendrix`.

---

## Task 5: `services/inventario-service.js` — escrita

**Files:**
- Modify: `_remote/src/services/inventario-service.js`

- [ ] **Step 1: Adicionar funções de escrita ao final do arquivo (antes do `module.exports`)**

Editar o arquivo e adicionar:

```js
// ─── ESCRITA ─────────────────────────────────────────────────

async function inserirItem(input, viaTomNome) {
  const obs = withViaTom(input.observacoes, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario')
    .insert({
      nome: input.nome,
      sala_id: input.sala_id,
      unidade_id: input.unidade_id,
      categoria: input.categoria || null,
      marca: input.marca || null,
      modelo: input.modelo || null,
      numero_serie: input.numero_serie || null,
      valor_compra: input.valor_compra ?? null,
      data_compra: input.data_compra || null,
      nota_fiscal: input.nota_fiscal || null,
      fornecedor: input.fornecedor || null,
      codigo_patrimonio: input.codigo_patrimonio || null,
      condicao: input.condicao || 'bom',
      status: input.status || 'ativo',
      quantidade: input.quantidade || 1,
      foto_url: input.foto_url || null,
      observacoes: obs,
      ativo: true,
      created_by: null,  // R1: NULL + via TOM em observacoes
    })
    .select('id, nome, codigo_patrimonio')
    .single();
  if (error) throw error;
  return data;
}

async function registrarMovimentacao(input, viaTomNome) {
  const obs = withViaTom(input.motivo, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario_movimentacoes')
    .insert({
      item_id: input.item_id,
      tipo: input.tipo,
      sala_origem_id: input.sala_origem_id || null,
      sala_destino_id: input.sala_destino_id || null,
      motivo: obs,
      data_movimentacao: new Date().toISOString(),
      usuario_id: null,  // R1
    })
    .select('id')
    .single();
  if (error) throw error;
  // Se for transferencia, atualiza sala do item
  if (input.tipo === 'transferencia' && input.sala_destino_id) {
    await laReportClient.from('inventario')
      .update({ sala_id: input.sala_destino_id, updated_at: new Date().toISOString() })
      .eq('id', input.item_id);
  }
  return data;
}

async function registrarManutencao(input, viaTomNome) {
  const obs = withViaTom(input.observacoes, viaTomNome);
  const { data, error } = await laReportClient
    .from('inventario_manutencoes')
    .insert({
      item_id: input.item_id,
      tipo: input.tipo || 'corretiva',
      descricao: input.descricao,
      custo: input.custo ?? null,
      data_manutencao: new Date().toISOString().slice(0, 10),
      data_proxima_revisao: input.data_proxima_revisao || null,
      responsavel: input.responsavel || null,
      fornecedor_servico: input.fornecedor_servico || null,
      observacoes: obs,
      created_by: null,  // R1
    })
    .select('id')
    .single();
  if (error) throw error;
  // Marca item como em manutenção
  await laReportClient.from('inventario')
    .update({ status: 'manutencao', updated_at: new Date().toISOString() })
    .eq('id', input.item_id);
  return data;
}

async function ajustarEstoqueLoja(input, viaTomNome) {
  // input: { produto_id, unidade_id, quantidade (positiva=entrada, negativa=saida), tipo, nota_fiscal?, motivo? }
  const obs = withViaTom(input.motivo || input.nota_fiscal || '', viaTomNome);

  // 1. Lê estoque atual (ou cria se não existir)
  const { data: existing } = await laReportClient
    .from('loja_estoque')
    .select('id, quantidade')
    .eq('produto_id', input.produto_id)
    .eq('unidade_id', input.unidade_id)
    .maybeSingle();

  let saldoApos;
  if (existing) {
    saldoApos = existing.quantidade + input.quantidade;
    if (saldoApos < 0) throw new Error('estoque_insuficiente');
    await laReportClient.from('loja_estoque')
      .update({ quantidade: saldoApos, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    if (input.quantidade < 0) throw new Error('estoque_inexistente_para_saida');
    saldoApos = input.quantidade;
    await laReportClient.from('loja_estoque')
      .insert({ produto_id: input.produto_id, unidade_id: input.unidade_id, quantidade: saldoApos });
  }

  // 2. Registra movimentação
  const { data, error } = await laReportClient
    .from('loja_movimentacoes_estoque')
    .insert({
      produto_id: input.produto_id,
      unidade_id: input.unidade_id,
      tipo: input.tipo || (input.quantidade > 0 ? 'entrada' : 'saida'),
      quantidade: Math.abs(input.quantidade),
      saldo_apos: saldoApos,
      observacoes: obs,
      colaborador_id: null,  // R1 — INT em vez de UUID, mas mesma regra: NULL + via TOM
    })
    .select('id')
    .single();
  if (error) throw error;
  return { saldo_apos: saldoApos, mov_id: data.id };
}

async function uploadFotoItem(itemId, buffer, contentType) {
  const path = `${itemId}/${Date.now()}.jpg`;
  const { error } = await laReportClient.storage
    .from('inventario-fotos')
    .upload(path, buffer, { contentType: contentType || 'image/jpeg', upsert: false });
  if (error) throw error;
  const { data: pub } = laReportClient.storage.from('inventario-fotos').getPublicUrl(path);
  // Atualiza foto_url no item
  await laReportClient.from('inventario')
    .update({ foto_url: pub.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', itemId);
  return pub.publicUrl;
}
```

- [ ] **Step 2: Atualizar o `module.exports` para incluir as novas funções**

```js
module.exports = {
  viaTomLabel, withViaTom,
  // leitura
  listarUnidades, listarSalasPorUnidade, buscarSalaPorNome, detalheSala,
  listarLojaPorUnidade, buscarProdutoPorNome,
  listarEstoqueBaixo, listarManutencoesPendentes, listarRevisoesProgramadas,
  // escrita
  inserirItem, registrarMovimentacao, registrarManutencao,
  ajustarEstoqueLoja, uploadFotoItem,
};
```

- [ ] **Step 3: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/services/inventario-service.js
```

---

## Task 6: Endpoints `/internal/lareport/*`

**Files:**
- Modify: `_remote/src/internal-api.js`

- [ ] **Step 1: Adicionar require do service no topo do arquivo (junto com outros requires)**

```js
const inventarioService = require('./services/inventario-service');
```

- [ ] **Step 2: Adicionar 5 endpoints (antes do `module.exports = app` / `app.listen`)**

```js
// ═══════════════════════════════════════════════════════════
// INVENTÁRIO (cross-project LA Report)
// ═══════════════════════════════════════════════════════════

// GET /internal/lareport/unidades
app.get('/internal/lareport/unidades', requireInternalSecret, async (_req, res) => {
  try {
    const data = await inventarioService.listarUnidades();
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/unidades:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/salas?unit=<uuid>
app.get('/internal/lareport/salas', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit;
  if (!unit) return res.status(400).json({ ok: false, error: 'unit_obrigatorio' });
  try {
    const data = await inventarioService.listarSalasPorUnidade(unit);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/salas:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/sala/:salaId
app.get('/internal/lareport/sala/:salaId', requireInternalSecret, async (req, res) => {
  const salaId = parseInt(req.params.salaId, 10);
  if (!Number.isInteger(salaId)) return res.status(400).json({ ok: false, error: 'sala_id_invalido' });
  try {
    const data = await inventarioService.detalheSala(salaId);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/sala/:id:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/loja?unit=<uuid>
app.get('/internal/lareport/loja', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit;
  if (!unit) return res.status(400).json({ ok: false, error: 'unit_obrigatorio' });
  try {
    const data = await inventarioService.listarLojaPorUnidade(unit);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('[internal-api] /lareport/loja:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /internal/lareport/alertas (consolidado)
app.get('/internal/lareport/alertas', requireInternalSecret, async (req, res) => {
  const unit = req.query.unit;  // opcional
  try {
    const [estoque, manut, revisoes] = await Promise.all([
      inventarioService.listarEstoqueBaixo(unit),
      inventarioService.listarManutencoesPendentes(14),
      inventarioService.listarRevisoesProgramadas(7),
    ]);
    res.json({ ok: true, data: { estoque_baixo: estoque, manutencoes_pendentes: manut, revisoes_proximas: revisoes } });
  } catch (e) {
    console.error('[internal-api] /lareport/alertas:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});
```

- [ ] **Step 3: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/internal-api.js
```

- [ ] **Step 4: Deploy + restart + smoke test endpoints**

```bash
scp D:/la-organizer/_remote/src/internal-api.js tom:/opt/LA-Organizer/src/
ssh tom "pm2 restart tom && sleep 2 && curl -s -H \"X-Internal-Secret: \$(grep INTERNAL_API_SECRET /opt/LA-Organizer/.env | cut -d= -f2)\" http://localhost:3100/internal/lareport/unidades"
```
Expected: JSON `{"ok":true,"data":[{"id":"...","nome":"Barra"},...]}` com 3 unidades.

---

## Task 7: PWA — Tipos `lib/lareport-types.ts`

**Files:**
- Create: `_remote/web/src/lib/lareport-types.ts`

- [ ] **Step 1: Escrever tipos**

```ts
// _remote/web/src/lib/lareport-types.ts
// Tipos espelhando schema do LA Report (cross-project).
// Schema confirmado em 2026-05-16 via execute_sql.

export interface ReportUnidade {
  id: string;
  nome: string;
}

export interface ReportSala {
  id: number;
  nome: string;
  tipo_sala: string | null;
  capacidade_maxima: number | null;
  recursos: string[] | null;
  codigo: string | null;
  ativo: boolean;
  itens_count?: number;
  unidades?: { nome: string };
}

export type CondicaoItem = 'novo' | 'bom' | 'regular' | 'ruim';
export type StatusItem = 'ativo' | 'manutencao' | 'baixa' | 'inativo';

export interface ReportInventarioItem {
  id: number;
  codigo_patrimonio: string | null;
  sala_id: number | null;
  unidade_id: string | null;
  nome: string;
  categoria: string | null;
  marca: string | null;
  modelo: string | null;
  numero_serie: string | null;
  valor_compra: number | null;
  data_compra: string | null;
  nota_fiscal: string | null;
  fornecedor: string | null;
  status: StatusItem | null;
  condicao: CondicaoItem | null;
  quantidade: number;
  foto_url: string | null;
  proxima_revisao: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportMovimentacao {
  id: number;
  item_id: number;
  tipo: string;
  sala_origem_id: number | null;
  sala_destino_id: number | null;
  motivo: string | null;
  data_movimentacao: string;
  inventario?: { nome: string; codigo_patrimonio: string | null };
}

export interface ReportManutencao {
  id: number;
  item_id: number;
  tipo: string;
  descricao: string;
  custo: number | null;
  data_manutencao: string;
  data_proxima_revisao: string | null;
  responsavel: string | null;
  fornecedor_servico: string | null;
  observacoes: string | null;
  inventario?: { nome: string; codigo_patrimonio: string | null; sala_id: number };
}

export interface ReportSalaDetalhe {
  sala: ReportSala;
  itens: ReportInventarioItem[];
  movimentacoes: ReportMovimentacao[];
  manutencoes: ReportManutencao[];
}

export interface ReportProduto {
  id: number;
  nome: string;
  sku: string | null;
  preco: number;
  custo: number | null;
  estoque_minimo: number | null;
  foto_url: string | null;
  disponivel_whatsapp: boolean;
  ativo: boolean;
  estoque_atual: number;
  abaixo_minimo: boolean;
  zerado: boolean;
  loja_categorias?: { nome: string; icone: string | null };
}

export interface ReportAlertas {
  estoque_baixo: ReportProduto[];
  manutencoes_pendentes: ReportManutencao[];
  revisoes_proximas: ReportInventarioItem[];
}

export const CATEGORIA_ICONES: Record<string, string> = {
  'Bateria': '🥁',
  'Canto/Vocal': '🎤',
  'Cordas': '🎸',
  'Piano/Teclado': '🎹',
  'Multiuso': '🎵',
  'Bateria/Percussão': '🥁',
  'Sopro': '🎺',
};

export function iconeParaTipoSala(tipoSala: string | null): string {
  if (!tipoSala) return '🎵';
  return CATEGORIA_ICONES[tipoSala] || '🎵';
}

export const CONDICAO_LABELS: Record<CondicaoItem, string> = {
  novo: 'Novo',
  bom: 'Bom',
  regular: 'Regular',
  ruim: 'Ruim',
};

export const STATUS_LABELS: Record<StatusItem, string> = {
  ativo: 'Ativo',
  manutencao: 'Em manutenção',
  baixa: 'Baixa',
  inativo: 'Inativo',
};
```

- [ ] **Step 2: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 8: PWA — Data layer `lib/lareport.ts`

**Files:**
- Create: `_remote/web/src/lib/lareport.ts`

- [ ] **Step 1: Escrever cliente HTTP**

```ts
// _remote/web/src/lib/lareport.ts
// Cliente HTTP para os endpoints /internal/lareport/* do TOM.
// IMPORTANTE: não importa @supabase/supabase-js — o PWA NÃO tem credenciais do LA Report.
// As credenciais ficam no TOM (VPS), que faz proxy autenticado via internal-api.

import type {
  ReportUnidade, ReportSala, ReportSalaDetalhe, ReportProduto, ReportAlertas,
} from './lareport-types';

const INTERNAL_API_BASE = import.meta.env.VITE_TOM_INTERNAL_BASE || 'https://tom.la-organizer.com';
const INTERNAL_API_SECRET = import.meta.env.VITE_TOM_INTERNAL_SECRET || '';

async function call<T>(path: string): Promise<T> {
  const res = await fetch(`${INTERNAL_API_BASE}${path}`, {
    headers: { 'X-Internal-Secret': INTERNAL_API_SECRET },
    credentials: 'include',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`internal-api ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'erro_desconhecido');
  return json.data as T;
}

export async function fetchReportUnidades(): Promise<ReportUnidade[]> {
  return call<ReportUnidade[]>('/internal/lareport/unidades');
}

export async function fetchReportSalas(unidadeId: string): Promise<ReportSala[]> {
  return call<ReportSala[]>(`/internal/lareport/salas?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportSalaDetalhe(salaId: number): Promise<ReportSalaDetalhe> {
  return call<ReportSalaDetalhe>(`/internal/lareport/sala/${salaId}`);
}

export async function fetchReportLoja(unidadeId: string): Promise<ReportProduto[]> {
  return call<ReportProduto[]>(`/internal/lareport/loja?unit=${encodeURIComponent(unidadeId)}`);
}

export async function fetchReportAlertas(unidadeId?: string): Promise<ReportAlertas> {
  const q = unidadeId ? `?unit=${encodeURIComponent(unidadeId)}` : '';
  return call<ReportAlertas>(`/internal/lareport/alertas${q}`);
}
```

- [ ] **Step 2: Confirmar que variáveis `VITE_TOM_INTERNAL_BASE` e `VITE_TOM_INTERNAL_SECRET` existem no Vercel**

```bash
grep -E "VITE_TOM_INTERNAL" D:/la-organizer/_remote/web/.env* 2>/dev/null || echo "Adicionar no Vercel: VITE_TOM_INTERNAL_BASE=https://tom.la-organizer.com e VITE_TOM_INTERNAL_SECRET=<secret>"
```
Se ausentes, pedir ao Owner pra adicionar via Vercel dashboard (Settings → Environment Variables) ou continuar com fallback hardcoded — temporário.

- [ ] **Step 3: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 9: PWA — Hooks `hooks/useLaReport.ts`

**Files:**
- Create: `_remote/web/src/hooks/useLaReport.ts`

- [ ] **Step 1: Escrever hooks**

```ts
// _remote/web/src/hooks/useLaReport.ts
import { useQuery } from '@tanstack/react-query';
import {
  fetchReportUnidades, fetchReportSalas, fetchReportSalaDetalhe,
  fetchReportLoja, fetchReportAlertas,
} from '../lib/lareport';

export function useReportUnidades() {
  return useQuery({
    queryKey: ['lareport-unidades'],
    queryFn: fetchReportUnidades,
    staleTime: 60 * 60_000,  // unidades raramente mudam
  });
}

export function useReportSalas(unidadeId: string | null) {
  return useQuery({
    queryKey: ['lareport-salas', unidadeId],
    queryFn: () => fetchReportSalas(unidadeId!),
    enabled: !!unidadeId,
    staleTime: 5 * 60_000,
  });
}

export function useReportSalaDetalhe(salaId: number | null) {
  return useQuery({
    queryKey: ['lareport-sala', salaId],
    queryFn: () => fetchReportSalaDetalhe(salaId!),
    enabled: !!salaId,
    staleTime: 30_000,
  });
}

export function useReportLoja(unidadeId: string | null) {
  return useQuery({
    queryKey: ['lareport-loja', unidadeId],
    queryFn: () => fetchReportLoja(unidadeId!),
    enabled: !!unidadeId,
    staleTime: 60_000,
  });
}

export function useReportAlertas(unidadeId?: string | null) {
  return useQuery({
    queryKey: ['lareport-alertas', unidadeId ?? 'all'],
    queryFn: () => fetchReportAlertas(unidadeId ?? undefined),
    staleTime: 60_000,
  });
}
```

- [ ] **Step 2: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 10: PWA — Componentes auxiliares

**Files:**
- Create: `_remote/web/src/screens/inventario/components/SalaCard.tsx`
- Create: `_remote/web/src/screens/inventario/components/ItemCard.tsx`
- Create: `_remote/web/src/screens/inventario/components/ProdutoCard.tsx`

- [ ] **Step 1: Criar `SalaCard.tsx`**

```tsx
// _remote/web/src/screens/inventario/components/SalaCard.tsx
import { Badge } from '../../../components/Badge';
import type { ReportSala } from '../../../lib/lareport-types';
import { iconeParaTipoSala } from '../../../lib/lareport-types';

interface Props {
  sala: ReportSala;
  onClick: () => void;
}

export function SalaCard({ sala, onClick }: Props) {
  const itens = sala.itens_count ?? 0;
  const semItens = itens === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-bg-surface rounded-lg border border-border p-md flex items-center gap-sm hover:border-tom transition text-left"
    >
      <div className="w-9 h-9 rounded-md bg-bg-app flex items-center justify-center text-lg flex-shrink-0">
        {iconeParaTipoSala(sala.tipo_sala)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{sala.nome}</div>
        <div className="text-[11px] text-fg-muted">
          {sala.tipo_sala || 'Multiuso'} · {(sala.recursos?.length ?? 0)} recursos
        </div>
      </div>
      <Badge tone={semItens ? 'danger' : 'neutral'}>{itens} itens</Badge>
      <span className="text-fg-muted">›</span>
    </button>
  );
}
```

- [ ] **Step 2: Criar `ItemCard.tsx`**

```tsx
// _remote/web/src/screens/inventario/components/ItemCard.tsx
import { Badge } from '../../../components/Badge';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props {
  item: ReportInventarioItem;
}

function condicaoTone(c: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (c === 'novo' || c === 'bom') return 'success';
  if (c === 'regular') return 'warning';
  if (c === 'ruim') return 'danger';
  return 'neutral';
}

function statusTone(s: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'ativo') return 'success';
  if (s === 'manutencao') return 'warning';
  if (s === 'baixa' || s === 'inativo') return 'danger';
  return 'neutral';
}

export function ItemCard({ item }: Props) {
  return (
    <div className="bg-bg-surface rounded-lg border border-border p-sm flex gap-sm">
      <div className="w-14 h-14 rounded-md bg-bg-app flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
        {item.foto_url ? (
          <img src={item.foto_url} alt={item.nome} className="w-full h-full object-cover" />
        ) : (
          <span>📦</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{item.nome}</div>
        {(item.marca || item.modelo) && (
          <div className="text-body-sm text-fg-muted truncate">
            {[item.marca, item.modelo].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="flex gap-1 items-center mt-1 flex-wrap">
          {item.codigo_patrimonio && (
            <span className="text-[10px] font-mono bg-bg-app px-1 py-0.5 rounded">
              {item.codigo_patrimonio}
            </span>
          )}
          {item.condicao && <Badge tone={condicaoTone(item.condicao)}>{item.condicao}</Badge>}
          {item.status && item.status !== 'ativo' && (
            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-center text-fg font-bold text-lg px-1">
        {item.quantidade ?? 1}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Criar `ProdutoCard.tsx`**

```tsx
// _remote/web/src/screens/inventario/components/ProdutoCard.tsx
import { Badge } from '../../../components/Badge';
import type { ReportProduto } from '../../../lib/lareport-types';

interface Props { produto: ReportProduto; }

export function ProdutoCard({ produto }: Props) {
  const tone = produto.zerado ? 'danger' : produto.abaixo_minimo ? 'warning' : 'success';
  const label = produto.zerado
    ? `Estoque: 0 ⚠`
    : produto.abaixo_minimo
    ? `Estoque: ${produto.estoque_atual} (mín ${produto.estoque_minimo}) ⚠`
    : `Estoque: ${produto.estoque_atual}`;
  return (
    <div className="bg-bg-surface rounded-lg border border-border p-sm flex gap-sm">
      <div className="w-14 h-14 rounded-md bg-bg-app flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
        {produto.foto_url ? (
          <img src={produto.foto_url} alt={produto.nome} className="w-full h-full object-cover" />
        ) : (
          <span>{produto.loja_categorias?.icone || '🛍'}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{produto.nome}</div>
        {produto.sku && (
          <div className="text-[10px] font-mono text-fg-muted">{produto.sku}</div>
        )}
        <div className="text-body-sm text-fg-muted mt-0.5">
          {produto.custo !== null && `Custo: R$${produto.custo} · `}Venda: R${produto.preco}
        </div>
        <div className="mt-1">
          <Badge tone={tone}>{label}</Badge>
        </div>
      </div>
      <div className="flex flex-col items-end justify-center text-fg font-bold text-lg px-1">
        R${produto.preco}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 11: PWA — `ListaPage` `/inventario`

**Files:**
- Create: `_remote/web/src/screens/inventario/ListaPage.tsx`

- [ ] **Step 1: Implementar página**

```tsx
// _remote/web/src/screens/inventario/ListaPage.tsx
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { useReportUnidades, useReportSalas, useReportLoja, useReportAlertas } from '../../hooks/useLaReport';
import { SalaCard } from './components/SalaCard';

export function InventarioListaPage() {
  const navigate = useNavigate();
  const { data: unidades = [], isLoading: lU } = useReportUnidades();
  const [unidadeId, setUnidadeId] = useState<string>('');

  useEffect(() => {
    if (!unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      setUnidadeId(barra?.id || unidades[0].id);
    }
  }, [unidades, unidadeId]);

  const { data: salas = [], isLoading: lS } = useReportSalas(unidadeId || null);
  const { data: produtos = [] } = useReportLoja(unidadeId || null);
  const { data: alertas } = useReportAlertas(unidadeId || undefined);

  const totalItens = useMemo(() => salas.reduce((s, sl) => s + (sl.itens_count ?? 0), 0), [salas]);
  const totalManutencao = alertas?.manutencoes_pendentes.length ?? 0;
  const estoqueBaixoCount = produtos.filter(p => p.abaixo_minimo || p.zerado).length;

  if (lU) return <LoadingState />;
  if (unidades.length === 0) {
    return (
      <div className="space-y-md pb-xl">
        <PageHeader title="Inventário" backTo="/mais" />
        <EmptyState icon="📦" title="Sem unidades" description="Nenhuma unidade configurada no LA Report." />
      </div>
    );
  }

  return (
    <div className="space-y-md pb-xl">
      <PageHeader title="Inventário" backTo="/mais" />

      <Tabs
        tabs={unidades.map(u => ({ id: u.id, label: u.nome }))}
        active={unidadeId}
        onChange={setUnidadeId}
      />

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Salas" value={salas.length} />
        <StatCard label="Itens" value={totalItens} />
        <StatCard label="Manut." value={totalManutencao} />
      </div>

      <button
        type="button"
        onClick={() => navigate('/inventario/loja')}
        className="w-full bg-fg text-bg-surface rounded-lg p-md flex items-center gap-md text-left hover:opacity-90"
      >
        <span className="text-2xl">🛍</span>
        <div className="flex-1">
          <div className="font-semibold">Lojinha</div>
          <div className="text-body-sm opacity-60">
            {produtos.length} produtos{estoqueBaixoCount > 0 ? ` · estoque baixo: ${estoqueBaixoCount} ⚠️` : ''}
          </div>
        </div>
        <span className="opacity-60">›</span>
      </button>

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Salas ({salas.length})</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      {lS ? (
        <LoadingState />
      ) : salas.length === 0 ? (
        <EmptyState icon="🏠" title="Sem salas ativas" description="Nenhuma sala ativa nesta unidade." />
      ) : (
        <div className="space-y-2">
          {salas.map(s => (
            <SalaCard key={s.id} sala={s} onClick={() => navigate(`/inventario/sala/${s.id}`)} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 12: PWA — `SalaPage` `/inventario/sala/:salaId`

**Files:**
- Create: `_remote/web/src/screens/inventario/SalaPage.tsx`

- [ ] **Step 1: Implementar página**

```tsx
// _remote/web/src/screens/inventario/SalaPage.tsx
import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Badge } from '../../components/Badge';
import { useReportSalaDetalhe } from '../../hooks/useLaReport';
import { ItemCard } from './components/ItemCard';
import { iconeParaTipoSala } from '../../lib/lareport-types';

type AbaSala = 'itens' | 'movimentacoes' | 'manutencao';

export function InventarioSalaPage() {
  const { salaId } = useParams<{ salaId: string }>();
  const id = salaId ? parseInt(salaId, 10) : null;
  const { data, isLoading } = useReportSalaDetalhe(id);
  const [aba, setAba] = useState<AbaSala>('itens');
  const [categoriaFilter, setCategoriaFilter] = useState<string | 'all'>('all');

  const categorias = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    for (const i of data.itens) if (i.categoria) set.add(i.categoria);
    return Array.from(set);
  }, [data]);

  const itensFiltrados = useMemo(() => {
    if (!data) return [];
    if (categoriaFilter === 'all') return data.itens;
    return data.itens.filter(i => i.categoria === categoriaFilter);
  }, [data, categoriaFilter]);

  if (isLoading || !data) return <LoadingState />;

  const sala = data.sala;
  const unidadeNome = sala.unidades?.nome ?? '';

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title={sala.nome}
        subtitle={`${unidadeNome ? unidadeNome + ' · ' : ''}${sala.tipo_sala || 'Multiuso'}`}
        backTo="/inventario"
      />

      <div className="bg-bg-surface rounded-lg border border-border p-md">
        <div className="flex items-center gap-sm mb-3">
          <div className="w-12 h-12 rounded-lg bg-success/10 text-success flex items-center justify-center text-2xl">
            {iconeParaTipoSala(sala.tipo_sala)}
          </div>
          <div>
            <div className="font-bold text-xl uppercase tracking-wide">{sala.nome}</div>
            <div className="text-[11px] text-fg-muted">
              {sala.tipo_sala || 'Multiuso'}
              {sala.capacidade_maxima ? ` · Capacidade: ${sala.capacidade_maxima} alunos` : ''}
            </div>
          </div>
        </div>
        {sala.recursos && sala.recursos.length > 0 && (
          <div className="text-[11px] text-fg pt-2 border-t border-border">
            <strong className="text-fg-muted">Recursos declarados:</strong> {sala.recursos.join(', ')}
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        {[
          { id: 'itens' as AbaSala, label: `Itens (${data.itens.length})` },
          { id: 'movimentacoes' as AbaSala, label: `Movimentações (${data.movimentacoes.length})` },
          { id: 'manutencao' as AbaSala, label: `Manutenção (${data.manutencoes.length})` },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAba(t.id)}
            className={`flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-md border ${
              aba === t.id ? 'bg-fg text-bg-surface border-fg' : 'bg-bg-surface border-border text-fg-muted'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {aba === 'itens' && (
        <>
          {categorias.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => setCategoriaFilter('all')}
                className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${
                  categoriaFilter === 'all' ? 'bg-tom text-black' : 'bg-bg-surface border border-border text-fg-muted'
                }`}
              >Todas</button>
              {categorias.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategoriaFilter(c)}
                  className={`text-[10px] px-2.5 py-1 rounded-full font-semibold ${
                    categoriaFilter === c ? 'bg-tom text-black' : 'bg-bg-surface border border-border text-fg-muted'
                  }`}
                >
                  {c} ({data.itens.filter(i => i.categoria === c).length})
                </button>
              ))}
            </div>
          )}
          {itensFiltrados.length === 0 ? (
            <EmptyState icon="📭" title="Sem itens" description="Nenhum item cadastrado nesta sala. Use o TOM no WhatsApp pra adicionar." />
          ) : (
            <div className="space-y-2">
              {itensFiltrados.map(i => <ItemCard key={i.id} item={i} />)}
            </div>
          )}
        </>
      )}

      {aba === 'movimentacoes' && (
        data.movimentacoes.length === 0 ? (
          <EmptyState icon="↔️" title="Sem movimentações" description="Nenhuma entrada/saída/transferência registrada." />
        ) : (
          <div className="space-y-2">
            {data.movimentacoes.map(m => (
              <div key={m.id} className="bg-bg-surface rounded-lg border border-border p-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-fg">
                    {m.inventario?.nome ?? `Item ${m.item_id}`}
                  </span>
                  <Badge tone="neutral">{m.tipo}</Badge>
                </div>
                {m.motivo && <div className="text-body-sm text-fg-muted">{m.motivo}</div>}
                <div className="text-[10px] text-fg-muted mt-1">
                  {new Date(m.data_movimentacao).toLocaleString('pt-BR')}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {aba === 'manutencao' && (
        data.manutencoes.length === 0 ? (
          <EmptyState icon="🔧" title="Sem manutenções" description="Nenhuma manutenção registrada para itens desta sala." />
        ) : (
          <div className="space-y-2">
            {data.manutencoes.map(m => (
              <div key={m.id} className="bg-bg-surface rounded-lg border border-border p-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-fg">
                    {m.inventario?.nome ?? `Item ${m.item_id}`}
                  </span>
                  <Badge tone="warning">{m.tipo}</Badge>
                </div>
                <div className="text-body-sm text-fg-muted">{m.descricao}</div>
                <div className="text-[10px] text-fg-muted mt-1">
                  {new Date(m.data_manutencao).toLocaleDateString('pt-BR')}
                  {m.custo ? ` · R$${m.custo}` : ''}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg-muted">
        💡 <strong className="text-fg">Pra adicionar item:</strong> escreve no WhatsApp do TOM tipo "comprei [item] pra sala {sala.nome} {unidadeNome}". Ou use <code className="bg-bg-surface px-1 rounded">/inv add</code>.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

---

## Task 13: PWA — `LojaPage` `/inventario/loja`

**Files:**
- Create: `_remote/web/src/screens/inventario/LojaPage.tsx`

- [ ] **Step 1: Implementar página**

```tsx
// _remote/web/src/screens/inventario/LojaPage.tsx
import { useState, useEffect, useMemo } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { useReportUnidades, useReportLoja } from '../../hooks/useLaReport';
import { ProdutoCard } from './components/ProdutoCard';

export function InventarioLojaPage() {
  const { data: unidades = [], isLoading: lU } = useReportUnidades();
  const [unidadeId, setUnidadeId] = useState<string>('');

  useEffect(() => {
    if (!unidadeId && unidades.length > 0) {
      const barra = unidades.find(u => u.nome === 'Barra');
      setUnidadeId(barra?.id || unidades[0].id);
    }
  }, [unidades, unidadeId]);

  const { data: produtos = [], isLoading } = useReportLoja(unidadeId || null);
  const baixos = useMemo(() => produtos.filter(p => p.abaixo_minimo || p.zerado), [produtos]);
  const totalUnidades = useMemo(() => produtos.reduce((s, p) => s + p.estoque_atual, 0), [produtos]);
  const valorEstoque = useMemo(
    () => produtos.reduce((s, p) => s + p.estoque_atual * (p.custo ?? 0), 0),
    [produtos]
  );

  if (lU) return <LoadingState />;

  return (
    <div className="space-y-md pb-xl">
      <PageHeader title="🛍 Lojinha" backTo="/inventario" />

      <Tabs
        tabs={unidades.map(u => ({ id: u.id, label: u.nome }))}
        active={unidadeId}
        onChange={setUnidadeId}
      />

      {baixos.length > 0 && (
        <div className="bg-danger/10 border border-danger/40 border-l-4 rounded-md p-md text-body-sm">
          ⚠️ <strong className="text-danger">{baixos.length} produto{baixos.length > 1 ? 's' : ''} abaixo do estoque mínimo nesta unidade.</strong>
          <br />Tom já avisou na segunda. Pra encomendar: <code className="bg-bg-surface px-1 rounded">/loja encomenda</code>.
        </div>
      )}

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Produtos" value={produtos.length} />
        <StatCard label="Unidades" value={totalUnidades} />
        <StatCard label="Valor estq." value={`R$${valorEstoque.toFixed(0)}`} />
      </div>

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Produtos</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : produtos.length === 0 ? (
        <EmptyState icon="🛍" title="Sem produtos" description="Nenhum produto cadastrado na lojinha." />
      ) : (
        <div className="space-y-2">
          {produtos.map(p => <ProdutoCard key={p.id} produto={p} />)}
        </div>
      )}

      <div className="bg-warning/10 border border-warning/40 rounded-md p-md text-body-sm text-fg-muted">
        💡 <strong className="text-fg">Recebeu mercadoria?</strong> Escreve no TOM "recebi 50 cadernos de violão pra Barra" ou use <code className="bg-bg-surface px-1 rounded">/loja entrada</code>.
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

---

## Task 14: PWA — Rotas + link Mais

**Files:**
- Modify: `_remote/web/src/App.tsx`
- Modify: `_remote/web/src/screens/Mais.tsx`

- [ ] **Step 1: Adicionar 3 imports no topo do `App.tsx`**

```tsx
import { InventarioListaPage } from './screens/inventario/ListaPage';
import { InventarioSalaPage } from './screens/inventario/SalaPage';
import { InventarioLojaPage } from './screens/inventario/LojaPage';
```

- [ ] **Step 2: Adicionar bloco de rotas dentro de `<AppShell>` (após bloco LA Journey)**

```tsx
{/* INVENTÁRIO — dados vêm do LA Report via internal-api do TOM. Read-only.
    Gated em coord/director/manager. RLS cross-project é bypassada via service_role no TOM.
    IMPORTANT: /inventario/loja antes de /inventario/sala/:salaId. */}
<Route element={<ProtectedRoute requireRoles={['coordinator', 'director', 'manager']} />}>
  <Route path="inventario" element={<InventarioListaPage />} />
  <Route path="inventario/loja" element={<InventarioLojaPage />} />
  <Route path="inventario/sala/:salaId" element={<InventarioSalaPage />} />
</Route>
```

- [ ] **Step 3: Adicionar link em `Mais.tsx` (após link LA Journey)**

```tsx
{(role === 'coordinator' || role === 'director' || role === 'manager') && (
  <li>
    <Link
      to="/inventario"
      className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring"
    >
      <div className="flex items-center gap-md">
        <span className="text-body-md">📦</span>
        <div>
          <div className="text-body-md">Inventário</div>
          <div className="text-body-sm text-fg-muted">Salas, equipamentos e lojinha</div>
        </div>
      </div>
      <ChevronRight size={18} className="text-fg-muted" />
    </Link>
  </li>
)}
```

- [ ] **Step 4: Validar TS + vite build**

```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Validar visualmente no Simple Browser**

Forçar reload (SW unregister + caches.delete), navegar pra `/inventario`, `/inventario/loja`, `/inventario/sala/<ID válido>`. Tirar 3 screenshots e comparar com mockups 01/03/02.

---

## Task 15: Skill `inventario.md`

**Files:**
- Create: `_remote/skills/inventario.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Skill: Inventário (LA Report)

## Triggers (R2 — contextuais, evitar falso-positivo)

**Triggers fortes (acionam sozinhas):**
- `inventário`, `inventario`, `patrimônio`, `patrimonio`
- `lojinha`, `loja`, `estoque baixo`, `estoque da`
- Comandos: `/inv`, `/loja`

**Triggers contextuais (acionam só com 2+ termos combinados):**
- Nome de unidade (`Barra`, `Recreio`, `Campo Grande`, `CG`) + qualquer outra trigger
- Nome conhecido de sala (`Hendrix`, `Amy`, `Drum Kids`, `Studio`, `Elton John`, `Ringo`, etc) + qualquer trigger
- Verbos operacionais (`comprei`, `recebi`, `peguei`, `levei`, `chiando`, `quebrado`) + nome de produto/equipamento musical

**Palavras isoladas NÃO acionam** (sala, corda, baqueta, bateria) — só viram contexto se já há outra trigger.

## Comandos rápidos

| Comando | Função |
|---|---|
| `/inv [unidade]` | Lista salas com contagem de itens |
| `/inv [sala] [unidade?]` | Detalhe da sala (fuzzy lookup) |
| `/inv add` | Fluxo guiado pra adicionar item |
| `/inv mov [item] [origem→destino] [motivo]` | Transferência entre salas |
| `/inv manutencao [item] [problema]` | Abre manutenção + cria task |
| `/inv alertas` | Resumo de alertas pendentes |
| `/loja [unidade]` | Produtos + estoque por unidade |
| `/loja entrada [qtd] [produto] [unidade] [NF?]` | Recebimento |
| `/loja saida [qtd] [produto] [unidade] [motivo]` | Saída manual |
| `/loja encomenda [unidade?]` | Lista de compra (estoque baixo) |

## Marker `<<INVENTORY_ACTION>>`

Quando o usuário descreve ação em linguagem natural, emita:

```
<<INVENTORY_ACTION>>
{
  "action": "add_item|move_item|maintenance|shop_movement|query_room|query_shop|query_rooms",
  "params": { ... }
}
<<END>>
```

### Schemas por action

**add_item:** `{ nome, sala_nome | sala_id, unidade_nome | unidade_id, categoria?, marca?, modelo?, quantidade?, valor_compra?, nota_fiscal?, fornecedor?, condicao? }`

**move_item:** `{ item_nome | item_id, tipo: 'entrada'|'saida'|'transferencia'|'baixa', sala_origem_nome?, sala_destino_nome?, motivo? }`

**maintenance:** `{ item_nome | item_id, tipo?: 'preventiva'|'corretiva', descricao, custo?, fornecedor_servico? }`

**shop_movement:** `{ produto_nome | produto_id, unidade_nome | unidade_id, quantidade, tipo: 'entrada'|'saida', nota_fiscal?, motivo? }`

**query_room:** `{ sala_nome, unidade_nome? }`

**query_shop:** `{ unidade_nome? }`

**query_rooms:** `{ unidade_nome }`

## Padrões de resposta

### Antes de gravar — SEMPRE confirmação inline
"Entendi: [resumo estruturado]. Confirmar?" — só executar após "sim"/"confirma"/"pode".

### Sucesso
"✅ [ação] registrada. [efeito visível, e.g., estoque atualizado, item movido]"

### Erro
"Faltou [campo]. Pode me dizer [pergunta específica]?"

## Comportamento

- **Sempre** usar `inventario-service` via marker — nunca inventar dados.
- **Sempre** prefixar `observacoes` ou `motivo` com `via TOM por [nome]` (R1).
- Quando fuzzy lookup retornar >1 resultado, perguntar qual.
- Para fotos: pedir ao usuário se quiser anexar; baixar da UAZAPI e salvar no bucket `inventario-fotos`.
- Pesquisa de preço → encaminhar pra skill `pesquisa-preco.md`.
```

- [ ] **Step 2: Deploy SCP**

```bash
scp D:/la-organizer/_remote/skills/inventario.md tom:/opt/LA-Organizer/skills/
```

---

## Task 16: Skill `pesquisa-preco.md`

**Files:**
- Create: `_remote/skills/pesquisa-preco.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Skill: Pesquisa de Preço

## Triggers
- "quanto custa", "quanto tá", "preço de", "preço do", "preço da"
- "orçamento de", "orçamento pra"
- "pesquisa preço", "pesquisar preço"

**Quando combinado com:** nome de equipamento musical (cabo, microfone, baqueta, encordoamento, teclado, bateria, amplificador, caixa de som, pedal, etc).

## Comportamento

1. Identificar o item + marca/modelo se mencionado.
2. Usar a tool **WebSearch** com query: `[item] [marca?] [modelo?] preço Mercado Livre OR Audiotec OR Amazon Brasil`.
3. Filtrar resultados pra ofertas comerciais (não tutorial).
4. Retornar **3 ofertas** com preço + link + nome da loja.
5. Apresentar média estimada.
6. Se for parte de manutenção em andamento, oferecer pré-preencher `inventario_manutencoes.custo` (ou criar campo `valor_estimado` em observacoes).

## Formato de resposta

```
Achei (web search):
• [marca/modelo] — R$XX (loja, link)
• [...]
• [...]

Média: ~R$YY
Quer que eu salve esse valor no item de manutenção?
```

## Limites

- **Não confirma compra** — só pesquisa preço.
- **Não acessa APIs pagas** — só web search público.
- Se a busca não retornar nada confiável: "Não consegui achar preço confiável. Quer tentar com mais detalhes?"
```

- [ ] **Step 2: Deploy SCP**

```bash
scp D:/la-organizer/_remote/skills/pesquisa-preco.md tom:/opt/LA-Organizer/skills/
```

---

## Task 17: Engine — handlers `/inv` + `/loja`

**Files:**
- Modify: `_remote/src/engine.js`

- [ ] **Step 1: Adicionar requires no topo (junto com outros requires)**

```js
const inventarioService = require('./services/inventario-service');
const inventarioValidators = require('./services/inventario-validators');
```

- [ ] **Step 2: Adicionar handler `/inv` após o handler `/journey`**

```js
// ─── /inv [...] ────────────────────────────────────────────
const invMatch = userMessage.trim().match(/^\/inv(?:\s+(.+))?$/i);
if (invMatch) {
  const arg = (invMatch[1] || '').trim();
  const tokens = arg.split(/\s+/).filter(Boolean);
  try {
    // Sem args: lista unidades
    if (tokens.length === 0) {
      const u = await inventarioService.listarUnidades();
      const linhas = u.map(x => `• ${x.nome} — /inv ${x.nome.toLowerCase().replace(/\s+/g, ' ')}`);
      return { type: 'text', text: `📦 *Inventário* — escolha a unidade:\n\n${linhas.join('\n')}`, _skipLLM: true };
    }
    // alertas
    if (tokens[0].toLowerCase() === 'alertas') {
      const [estoque, manut, revisoes] = await Promise.all([
        inventarioService.listarEstoqueBaixo(),
        inventarioService.listarManutencoesPendentes(14),
        inventarioService.listarRevisoesProgramadas(7),
      ]);
      let reply = `🔔 *Alertas inventário*\n\n`;
      reply += `🔴 Estoque baixo: ${estoque.length}\n`;
      reply += `🔧 Manutenções +14d: ${manut.length}\n`;
      reply += `🗓 Revisões próximas (7d): ${revisoes.length}\n`;
      return { type: 'text', text: reply, _skipLLM: true };
    }
    // Outros subcomandos delegados pro LLM via marker (mais flexível)
    // O LLM detecta intenção e emite <<INVENTORY_ACTION>>
    return null; // continua fluxo normal
  } catch (e) {
    return { type: 'text', text: `Erro: ${e.message}`, _skipLLM: true };
  }
}
```

- [ ] **Step 3: Adicionar handler `/loja` análogo**

```js
// ─── /loja [...] ────────────────────────────────────────────
const lojaMatch = userMessage.trim().match(/^\/loja(?:\s+(.+))?$/i);
if (lojaMatch) {
  const arg = (lojaMatch[1] || '').trim().toLowerCase();
  try {
    // Sem args: lista unidades
    if (!arg) {
      const u = await inventarioService.listarUnidades();
      const linhas = u.map(x => `• ${x.nome} — /loja ${x.nome.toLowerCase()}`);
      return { type: 'text', text: `🛍 *Lojinha* — escolha a unidade:\n\n${linhas.join('\n')}`, _skipLLM: true };
    }
    // /loja encomenda
    if (arg === 'encomenda' || arg.startsWith('encomenda ')) {
      const unitMatch = arg.match(/^encomenda\s+(.+)$/);
      let unitId = null;
      if (unitMatch) {
        const u = await inventarioService.listarUnidades();
        const found = u.find(x => x.nome.toLowerCase().includes(unitMatch[1]));
        if (found) unitId = found.id;
      }
      const baixos = await inventarioService.listarEstoqueBaixo(unitId);
      if (baixos.length === 0) {
        return { type: 'text', text: '✅ Sem produtos abaixo do mínimo.', _skipLLM: true };
      }
      const linhas = baixos.map(p => `• ${p.nome} — ${p.estoque_atual}/${p.estoque_minimo} (custo R$${p.custo || '?'})`);
      return { type: 'text', text: `🛒 *Lista de encomenda:*\n\n${linhas.join('\n')}`, _skipLLM: true };
    }
    // /loja <unidade>
    const u = await inventarioService.listarUnidades();
    const unidade = u.find(x => x.nome.toLowerCase().includes(arg));
    if (!unidade) {
      return { type: 'text', text: `Unidade "${arg}" não encontrada. Use: ${u.map(x => x.nome).join(', ')}`, _skipLLM: true };
    }
    const produtos = await inventarioService.listarLojaPorUnidade(unidade.id);
    let reply = `🛍 *Lojinha · ${unidade.nome}*\n\n`;
    for (const p of produtos) {
      const flag = p.zerado ? '🔴' : p.abaixo_minimo ? '🟠' : '✅';
      reply += `${flag} ${p.nome}: ${p.estoque_atual} un (R$${p.preco})\n`;
    }
    return { type: 'text', text: reply.trim(), _skipLLM: true };
  } catch (e) {
    return { type: 'text', text: `Erro: ${e.message}`, _skipLLM: true };
  }
}
```

- [ ] **Step 4: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/engine.js
```

---

## Task 18: Engine — parser do marker `<<INVENTORY_ACTION>>`

**Files:**
- Modify: `_remote/src/engine.js`

- [ ] **Step 1: Encontrar onde markers existentes (como `<<CHECKLIST_ACTION>>`) são parseados**

Pattern existente provavelmente é regex extraindo blocos `<<NAME>>...<<END>>` da resposta do LLM.

- [ ] **Step 2: Adicionar parser análogo pra `<<INVENTORY_ACTION>>` (depois dos outros parsers)**

```js
// ─── <<INVENTORY_ACTION>> parser ────────────────────────────
const invActionMatch = llmReply.match(/<<INVENTORY_ACTION>>([\s\S]*?)<<END>>/);
if (invActionMatch) {
  let payload;
  try {
    payload = JSON.parse(invActionMatch[1].trim());
  } catch (parseErr) {
    console.error('[engine] INVENTORY_ACTION JSON parse erro:', parseErr);
    return { type: 'text', text: 'Não consegui interpretar o pedido. Pode reformular?' };
  }
  const baseCheck = inventarioValidators.validateAction(payload);
  if (!baseCheck.ok) {
    return { type: 'text', text: `Pedido inválido: ${baseCheck.errors.join(', ')}` };
  }
  // strip marker from reply
  llmReply = llmReply.replace(/<<INVENTORY_ACTION>>[\s\S]*?<<END>>/g, '').trim();

  const userName = currentUser?.full_name || 'usuário';
  const p = payload.params;
  try {
    // Resolução de sala/unidade por nome
    async function resolverUnidadeId(nome) {
      if (p.unidade_id) return p.unidade_id;
      if (!nome) return null;
      const u = await inventarioService.listarUnidades();
      const m = u.find(x => x.nome.toLowerCase() === nome.toLowerCase()) ||
                u.find(x => x.nome.toLowerCase().includes(nome.toLowerCase()));
      return m?.id ?? null;
    }
    async function resolverSalaId(nomeSala, unidadeId) {
      if (p.sala_id) return p.sala_id;
      if (!nomeSala) return null;
      const r = await inventarioService.buscarSalaPorNome(nomeSala, unidadeId);
      if (r.length === 0) return null;
      if (r.length > 1) {
        return { ambiguous: r.map(x => `${x.nome} (id ${x.id})`).join(', ') };
      }
      return r[0].id;
    }

    if (payload.action === 'add_item') {
      const vc = inventarioValidators.validateAddItem(p);
      if (!vc.ok) return { type: 'text', text: `Faltam dados: ${vc.errors.join(', ')}` };
      const unidadeId = await resolverUnidadeId(p.unidade_nome);
      if (!unidadeId) return { type: 'text', text: `Unidade "${p.unidade_nome}" não encontrada.` };
      const salaId = await resolverSalaId(p.sala_nome, unidadeId);
      if (salaId == null) return { type: 'text', text: `Sala "${p.sala_nome}" não encontrada na ${p.unidade_nome}.` };
      if (typeof salaId === 'object' && salaId.ambiguous) {
        return { type: 'text', text: `Mais de uma sala: ${salaId.ambiguous}. Qual?` };
      }
      const item = await inventarioService.inserirItem({ ...p, sala_id: salaId, unidade_id: unidadeId }, userName);
      return { type: 'text', text: `✅ Item adicionado: ${item.nome}${item.codigo_patrimonio ? ` (${item.codigo_patrimonio})` : ''}` };
    }

    if (payload.action === 'shop_movement') {
      const vc = inventarioValidators.validateShopMovement(p);
      if (!vc.ok) return { type: 'text', text: `Faltam dados: ${vc.errors.join(', ')}` };
      const unidadeId = await resolverUnidadeId(p.unidade_nome);
      if (!unidadeId) return { type: 'text', text: `Unidade "${p.unidade_nome}" não encontrada.` };
      let produtoId = p.produto_id;
      if (!produtoId) {
        const prods = await inventarioService.buscarProdutoPorNome(p.produto_nome);
        if (prods.length === 0) return { type: 'text', text: `Produto "${p.produto_nome}" não cadastrado na lojinha.` };
        if (prods.length > 1) return { type: 'text', text: `Mais de um produto: ${prods.map(x => x.nome).join(', ')}. Qual?` };
        produtoId = prods[0].id;
      }
      const qty = p.tipo === 'entrada' ? Math.abs(p.quantidade) : -Math.abs(p.quantidade);
      const res = await inventarioService.ajustarEstoqueLoja({
        produto_id: produtoId, unidade_id: unidadeId, quantidade: qty, tipo: p.tipo,
        nota_fiscal: p.nota_fiscal, motivo: p.motivo,
      }, userName);
      return { type: 'text', text: `✅ Estoque atualizado. Saldo agora: ${res.saldo_apos} un.` };
    }

    if (payload.action === 'move_item' || payload.action === 'maintenance') {
      // Resolução de item por nome — best-effort
      let itemId = p.item_id;
      if (!itemId && p.item_nome) {
        const { data } = await require('./services/la-report-client').laReportClient
          .from('inventario').select('id, nome').ilike('nome', `%${p.item_nome}%`).eq('ativo', true).limit(5);
        if (!data || data.length === 0) return { type: 'text', text: `Item "${p.item_nome}" não encontrado.` };
        if (data.length > 1) return { type: 'text', text: `Mais de um item: ${data.map(x => x.nome).join(', ')}. Qual?` };
        itemId = data[0].id;
      }
      if (payload.action === 'move_item') {
        const vc = inventarioValidators.validateMoveItem(p);
        if (!vc.ok) return { type: 'text', text: `Faltam dados: ${vc.errors.join(', ')}` };
        let destinoId = p.sala_destino_id;
        if (!destinoId && p.sala_destino_nome) {
          const r = await inventarioService.buscarSalaPorNome(p.sala_destino_nome);
          if (r.length === 1) destinoId = r[0].id;
        }
        await inventarioService.registrarMovimentacao({
          item_id: itemId, tipo: p.tipo, sala_destino_id: destinoId, motivo: p.motivo,
        }, userName);
        return { type: 'text', text: `✅ Movimentação registrada.` };
      } else {
        const vc = inventarioValidators.validateMaintenance(p);
        if (!vc.ok) return { type: 'text', text: `Faltam dados: ${vc.errors.join(', ')}` };
        await inventarioService.registrarManutencao({
          item_id: itemId, tipo: p.tipo, descricao: p.descricao, custo: p.custo,
          fornecedor_servico: p.fornecedor_servico,
        }, userName);
        return { type: 'text', text: `🔧 Manutenção registrada.` };
      }
    }

    if (payload.action === 'query_room' || payload.action === 'query_shop' || payload.action === 'query_rooms') {
      // Não escreve nada — apenas reforça a query.
      // O fluxo natural já vai responder com snapshot do system prompt.
      return null;
    }

    return { type: 'text', text: `Ação ${payload.action} ainda não suportada.` };
  } catch (e) {
    console.error('[engine] INVENTORY_ACTION execução:', e);
    return { type: 'text', text: `Erro ao executar: ${e.message}` };
  }
}
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/engine.js
```

---

## Task 19: Detection contextual em `prompts/system.js`

**Files:**
- Modify: `_remote/src/prompts/system.js`

- [ ] **Step 1: Adicionar bloco de detecção após o bloco LA Journey**

```js
// ─── INVENTÁRIO — detecção contextual (R2) ───────────────────
const lowerMsg = userMessage.toLowerCase();
const triggersFortesInv = ['inventário', 'inventario', 'patrimônio', 'patrimonio', 'lojinha', 'loja', 'estoque baixo', 'estoque da'];
const cmdsInv = /^\s*\/(inv|loja)\b/.test(lowerMsg);
const unidadesNomes = ['barra', 'recreio', 'campo grande', ' cg '];
const verbosOperacionais = ['comprei', 'recebi', 'peguei', 'levei', 'chiando', 'quebrado', 'quebrou', 'falta', 'acabou'];
const matchUnidade = unidadesNomes.some(u => (' ' + lowerMsg + ' ').includes(u));
const matchVerbo = verbosOperacionais.some(v => lowerMsg.includes(v));
const matchInvForte = triggersFortesInv.some(t => lowerMsg.includes(t));
const matchInv = cmdsInv || matchInvForte || (matchUnidade && matchVerbo);

if (matchInv) {
  try {
    const { laReportClient, isLaReportConfigured } = require('../services/la-report-client');
    if (isLaReportConfigured()) {
      // Snapshot leve: unidades + nomes de salas conhecidas (pra LLM resolver fuzzy)
      const { data: unidades } = await laReportClient.from('unidades').select('id, nome');
      const { data: salas } = await laReportClient.from('salas').select('id, nome, tipo_sala, unidade_id').eq('ativo', true);
      const { data: produtos } = await laReportClient.from('loja_produtos').select('id, nome, sku').eq('ativo', true);
      systemPrompt += `\n\n[INVENTARIO_CATALOGO]\n`;
      systemPrompt += `Unidades: ${(unidades || []).map(u => `${u.nome}(${u.id})`).join(', ')}\n`;
      systemPrompt += `Salas: ${(salas || []).map(s => `${s.nome}/${s.tipo_sala || '?'}/uid=${s.unidade_id}`).join(' | ')}\n`;
      systemPrompt += `Produtos lojinha: ${(produtos || []).map(p => `${p.nome}${p.sku ? '(' + p.sku + ')' : ''}`).join(', ')}\n\n`;
      systemPrompt += `Quando o usuário descrever uma ação operacional, use a skill inventario.md e emita <<INVENTORY_ACTION>>...<<END>> com JSON estruturado. Sempre confirmar antes de gravar.`;
    }
  } catch (e) {
    systemPrompt += `\n[INVENTARIO_CATALOGO]\nErro ao carregar catálogo: ${e.message}`;
  }
}
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

---

## Task 20: Cron alertas `rituals/inventario-alertas.js`

**Files:**
- Create: `_remote/src/rituals/inventario-alertas.js`
- Modify: `_remote/src/rituals/dispatcher.js`

- [ ] **Step 1: Escrever o ritual**

```js
// _remote/src/rituals/inventario-alertas.js
// Cron semanal (segunda 09h) de alertas operacionais de inventário/loja.
// Lê do LA Report e enfileira mensagens em la_organizer.notifications.

const inventarioService = require('../services/inventario-service');
const supabase = require('../supabase/client');  // LA Organizer

async function rafinhaId() {
  const { data } = await supabase
    .from('collaborators').select('id').ilike('full_name', '%rafinha%').eq('active', true).maybeSingle();
  return data?.id || null;
}

async function gerentePorUnidade(unidadeNome) {
  if (!unidadeNome) return [];
  const { data } = await supabase
    .from('collaborators').select('id, full_name').eq('role', 'manager').eq('active', true)
    .ilike('unit', `%${unidadeNome.toLowerCase()}%`);
  return data || [];
}

async function enfileirarNotificacao(collaboratorId, titulo, corpo) {
  if (!collaboratorId) return;
  await supabase.from('notifications').insert({
    collaborator_id: collaboratorId,
    title: titulo,
    body: corpo,
    kind: 'inventario_alerta',
    created_at: new Date().toISOString(),
  });
}

async function runInventarioEstoqueBaixo() {
  const baixos = await inventarioService.listarEstoqueBaixo();
  if (baixos.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = baixos.map(p => `• ${p.nome}: ${p.estoque_atual}/${p.estoque_minimo}`);
  const corpo = `🔴 *Estoque baixo* (${baixos.length} produto${baixos.length > 1 ? 's' : ''}):\n\n${linhas.join('\n')}\n\nPra encomendar: /loja encomenda`;
  await enfileirarNotificacao(rafinha, 'Estoque baixo', corpo);
}

async function runInventarioManutencoesPendentes() {
  const pendentes = await inventarioService.listarManutencoesPendentes(14);
  if (pendentes.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = pendentes.map(m => {
    const dias = Math.floor((Date.now() - new Date(m.data_manutencao).getTime()) / 86400000);
    const nome = m.inventario?.nome || `Item ${m.item_id}`;
    return `• ${nome} — ${dias}d (${m.tipo})`;
  });
  const corpo = `🔧 *Manutenções pendentes +14d* (${pendentes.length}):\n\n${linhas.join('\n')}`;
  await enfileirarNotificacao(rafinha, 'Manutenções pendentes', corpo);
}

async function runInventarioRevisoesProgramadas() {
  const revisoes = await inventarioService.listarRevisoesProgramadas(7);
  if (revisoes.length === 0) return;
  const rafinha = await rafinhaId();
  const linhas = revisoes.map(i => {
    const data = i.proxima_revisao ? new Date(i.proxima_revisao).toLocaleDateString('pt-BR') : '?';
    return `• ${i.nome} — ${data}`;
  });
  const corpo = `🗓 *Revisões programadas (próximos 7d)* (${revisoes.length}):\n\n${linhas.join('\n')}`;
  await enfileirarNotificacao(rafinha, 'Revisões programadas', corpo);
}

module.exports = {
  runInventarioEstoqueBaixo,
  runInventarioManutencoesPendentes,
  runInventarioRevisoesProgramadas,
};
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/rituals/inventario-alertas.js
```

- [ ] **Step 3: Adicionar import no `dispatcher.js`**

```js
const {
  runInventarioEstoqueBaixo,
  runInventarioManutencoesPendentes,
  runInventarioRevisoesProgramadas,
} = require('./inventario-alertas');
```

- [ ] **Step 4: Adicionar bloco cron no dispatcher (segunda 09h, após blocos LA Journey)**

Adaptar ao padrão do dispatcher (inline SQL pra `ritual_logs`, igual blocos LA Journey existentes):

```js
// INVENTÁRIO — Segunda 09h: alertas semanais (3 funções, 1 trigger único)
if (dow === 1 && hour === 9 && !(await logExists('inventario_alertas_semanal'))) {
  console.log('[dispatcher] rodando alertas inventário');
  try {
    await runInventarioEstoqueBaixo();
    await runInventarioManutencoesPendentes();
    await runInventarioRevisoesProgramadas();
    await logRitual('inventario_alertas_semanal');
  } catch (e) { console.error('[dispatcher] falha alertas inventário:', e); }
}
```

(Se o dispatcher usa pattern inline ao invés de `logExists`/`logRitual`, seguir o padrão inline já existente nos blocos LA Journey.)

- [ ] **Step 5: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/rituals/dispatcher.js
```

---

## Task 21: Deploy TOM completo + restart

**Files:**
- VPS deploy.

- [ ] **Step 1: SCP de tudo + restart**

```bash
scp D:/la-organizer/_remote/src/services/la-report-client.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/inventario-service.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/inventario-validators.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/internal-api.js tom:/opt/LA-Organizer/src/
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/
scp D:/la-organizer/_remote/src/rituals/inventario-alertas.js tom:/opt/LA-Organizer/src/rituals/
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/
scp D:/la-organizer/_remote/skills/inventario.md tom:/opt/LA-Organizer/skills/
scp D:/la-organizer/_remote/skills/pesquisa-preco.md tom:/opt/LA-Organizer/skills/
ssh tom "pm2 restart tom && pm2 logs tom --lines 10 --nostream | tail -15"
```

Expected: PM2 reinicia limpo, sem erros de import. Logs mostram `✅ TOM pronto`.

---

## Task 22: Smoke test E2E

- [ ] **Step 1: TypeScript final**
```bash
cd D:/la-organizer/_remote/web && npx tsc --noEmit
```

- [ ] **Step 2: Vite build**
```bash
cd D:/la-organizer/_remote/web && npx vite build
```

- [ ] **Step 3: Validar 3 telas PWA visualmente**

Via `mcp__Claude_Preview__preview_eval` + `preview_screenshot`:
1. `/inventario` — tabs unidade + stats + card lojinha + lista de salas (8 na Barra)
2. `/inventario/loja` — produtos + estoque + alerta baixo
3. `/inventario/sala/<id de Hendrix>` — header + tabs + lista vazia (esperado, inventário ainda não populado)

Comparar com mockups 01, 03, 02.

- [ ] **Step 4: Smoke test endpoints internal-api**

```bash
ssh tom 'SECRET=$(grep INTERNAL_API_SECRET /opt/LA-Organizer/.env | cut -d= -f2);
for path in /internal/lareport/unidades "/internal/lareport/salas?unit=368d47f5-2d88-4475-bc14-ba084a9a348e" /internal/lareport/alertas; do
  echo "=== $path ===";
  curl -s -H "X-Internal-Secret: $SECRET" "http://localhost:3100$path" | head -c 300;
  echo "";
done'
```

Expected: 3 endpoints retornam `{"ok":true,"data":...}`.

- [ ] **Step 5: Smoke test slash `/inv` e `/loja` via simulação**

Forma manual: enviar via WhatsApp pro TOM as msgs `/inv`, `/inv alertas`, `/loja`, `/loja barra`. Verificar respostas formatadas.

Alternativa programática:
```bash
ssh tom 'curl -s -X POST -H "X-Internal-Secret: $(grep INTERNAL_API_SECRET /opt/LA-Organizer/.env | cut -d= -f2)" -H "Content-Type: application/json" -d "{\"text\":\"/inv\",\"phone\":\"+5521999999999\"}" http://localhost:3100/internal/debug/process-message' || echo "endpoint de debug não existe — testar manual via WhatsApp"
```

- [ ] **Step 6: Verificar que PWA NÃO embarcou service_role_key**

```bash
grep -r "ouqwbbermlzqqvtqwlul\|service_role" D:/la-organizer/_remote/web/dist 2>&1 | head -5
```
Expected: 0 ocorrências. Se aparecer alguma, é bug crítico — investigar.

---

## Self-Review

### Spec coverage

| Item do spec | Task |
|---|---|
| Auditoria do banco (já feita) | — |
| R1 (NULL + via TOM) | Tasks 4, 5 (withViaTom helper + uso em inserts) |
| R2 (detection contextual) | Task 19 (system.js) |
| R3 (escopo Fases 1+2+3) | todo o plano (Fase 4 explicitamente fora) |
| R4 (slash + marker) | Tasks 17, 18 |
| Mockups 1-4 | Tasks 11, 12, 13, 15 (skill com exemplos) |
| Design system obrigatório | Tasks 10-13 (Card/PageHeader/Tabs/StatCard/Badge/EmptyState/LoadingState) |
| Rotas PWA + Mais link | Task 14 |
| Backend cross-project (client + service + validators) | Tasks 2, 3, 4, 5 |
| Endpoints internal-api | Task 6 |
| PWA data layer + hooks | Tasks 7, 8, 9 |
| TOM slash + marker | Tasks 17, 18 |
| Skill inventario.md + pesquisa-preco.md | Tasks 15, 16 |
| Cron alertas (3 funções) | Task 20 |
| Dispatcher wiring | Task 20 |
| Permissões (gating em manager/coord/director) | Task 14 (ProtectedRoute + Mais link) |
| Storage de fotos | Task 5 (uploadFotoItem) |
| Critérios de aceite | Task 22 |

### Placeholder scan
Sem "TBD", "TODO". Todo código real. Tasks 18-19 reusam padrões existentes do projeto (referência explícita) com fallback claro ("se o pattern do dispatcher é inline ao invés de helper, seguir o inline").

### Type consistency
- `ReportSala.id` é `number` (não UUID) — consistente em todas tasks
- `unidade_id` é `string` (UUID) — consistente
- `inventarioService.viaTomLabel(nome)` retorna string — usado em insertions
- `payload.action` enum — validado em `validateAction`
- `useReportSalaDetalhe(salaId)` recebe `number | null` — `parseInt` no SalaPage

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-16-la-report-integration-implementation.md`.**
