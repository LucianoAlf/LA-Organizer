# LA EDUCA — Spec de Design

> **Módulo:** Acompanhamento de Estagiários Pedagógicos
> **Owner:** Luciano Alf
> **Data:** 2026-05-16
> **Status:** Aprovado para implementação
> **Referência:** `docs/PRD-LA-EDUCA-Modulo-LA-Organizer.md`

---

## 1. Contexto

A LA Music tem um programa de estagiários pedagógicos que entram em sala depois de passar pela **Trilha de Ancoragem LA EDUCA** — 4 pilares de avaliação conduzidos por mentores e supervisionados por coordenadores. Hoje a avaliação é manual (HTML externo), sem visibilidade da coordenação nem rastreabilidade.

Este spec descreve a migração desse processo pro LA Organizer como um módulo dedicado, com lembretes automáticos via TOM (WhatsApp).

---

## 2. Estado atual do banco (validado em 2026-05-16)

O Claude Chat já criou toda a estrutura. **Nenhuma migration nova é necessária.**

| Tabela / View | Status | Observações |
|---|---|---|
| `la_educa_estagiarios` | ✅ criada | FKs em `collaborators` (mentor_id, certificado_emitido_por). RLS: read = mentor OR coord/director; write = coord/director only |
| `la_educa_checkpoints` | ✅ criada + 26 rows seedados | `id TEXT` (ex: `p1.1`, `p2m.1`, `p2i.5`). Coluna `modalidade_filtro` (null=todos, `musicalizacao`, `instrumento`). RLS: read público (auth) |
| `la_educa_avaliacoes` | ✅ criada | Inclui `justificativa_baixa TEXT`. RLS herda da estagiários via JOIN |
| `la_educa_historico` | ✅ criada + trigger automático | Trigger grava nota_anterior/nova + ancorado_anterior/novo em todo UPDATE. **Client NÃO precisa logar.** |
| `la_educa_lembretes_log` | ✅ criada | Usada pra idempotência dos lembretes do TOM |
| `la_educa_progresso` (view) | ✅ criada | Retorna: `id, nome, unidade, modalidade, instrumento, data_inicio, status, mentor_id, mentor_nome, checkpoints_ancorados, checkpoints_total, percentual, certificado_emitido, certificado_emitido_em, ultima_atualizacao` |

**Distribuição dos 26 checkpoints:**
- P1 (Teoria Musical): 6 — todos modalidade_filtro=null
- P2 (Prática) — 10 total:
  - `p2m.1` a `p2m.5` (musicalização)
  - `p2i.1` a `p2i.5` (instrumento)
- P3 (Metodologia Pedagógica): 6 — todos modalidade_filtro=null
- P4 (Vivência de Sala): 4 — todos modalidade_filtro=null

**RLS policies (resumo):**
- Estagiários: mentor lê os seus / coord+director CRUD sem restrição de unidade
- Avaliações: mentor do estagiário OR coord/director — read + write
- Checkpoints: read público pra qualquer autenticado
- Histórico: read via JOIN com avaliações
- Lembretes log: destinatário OR coord/director

---

## 3. Arquitetura PWA

### 3.1 Rotas

```
/mais                                  (já existe — adicionar link condicional "LA EDUCA")
/la-educa                              ListaPage
/la-educa/novo                         CadastroEstagiarioPage  (só coord/director)
/la-educa/:estagiarioId                EstagiarioDetalhePage   (4 cards de pilar)
/la-educa/:estagiarioId/:pilar         PilarAvaliacaoPage      (lista de checkpoints)
```

Todas as rotas protegidas por `<RoleGuard allow={['coordinator','director','collaborator']}>` (collaborator inclui mentores — RLS no banco filtra os estagiários). Sem permissão → redirect pra `/mais`.

Identificação de mentor: qualquer `collaborator` com pelo menos 1 row em `la_educa_estagiarios.mentor_id = c.id`. Não há role novo "mentor".

### 3.2 Estrutura de arquivos

```
web/src/
  pages/laeduca/
    ListaPage.tsx
    CadastroEstagiarioPage.tsx
    EstagiarioDetalhePage.tsx
    PilarAvaliacaoPage.tsx
    components/
      ProgressBar.tsx           # % + cor (verde >80, amarelo 40-80, vermelho <40)
      PilarCard.tsx             # ícone + nome + X/Y + badge status
      CheckpointRow.tsx         # slider + textarea + botão âncora (modal nota<7)
      AlertCard.tsx             # 🔴🟡🟢 — usado só pela visão coord
      JustificativaModal.tsx    # modal nota<7, textarea required min 20 chars
  lib/
    laeduca.ts                  # fetchers (lista, detalhe, avaliações, ancorar, cadastrar, certificar)
    laeduca-types.ts            # tipos TypeScript das 5 tabelas + view
  hooks/
    useLaEducaProgresso.ts      # TanStack query da view (filtrada por unidade do collaborator se for coord)
    useLaEducaEstagiario.ts     # detalhe + avaliações agrupadas por pilar
```

Componentes existentes do design system serão reusados onde já houver pattern:
- Cards/contêineres com classes `bg-bg-surface`, `rounded-lg`, `p-md`, `shadow-sm`
- Botões com `bg-tom`, `text-white`, `rounded-md`, `px-md py-sm`
- Inputs padrão TailwindCSS já em uso em `OnboardingWizard` / `CadastroProjeto`
- Toast existente (`ToastHost`) pra feedback de ações
- Sem inventar nova identidade visual

### 3.3 Página: Lista (`/la-educa`)

**Visão coord/director:**
1. Header "LA EDUCA — Acompanhamento de Estagiários"
2. Cards de alerta (só aparecem se houver):
   - 🔴 Atrasados: estagiários com `ultima_atualizacao > 14 dias`
   - 🟢 Prontos pra certificar: `percentual = 100 AND certificado_emitido = false`
3. Filtro por unidade (Campo Grande / Recreio / Barra da Tijuca / Todas)
4. Tabela de estagiários (mobile = lista de cards):
   - Nome | Modalidade | Mentor | Progresso (ProgressBar) | Status | Última atualização | "Ver"
5. Botão flutuante "+ Novo Estagiário" (só coord/director)

**Visão mentor (collaborator que tem estagiários):**
- Mesma tabela mas filtrada pelo banco (RLS) — só os dele
- Sem cards de alerta (são pra coord)
- Sem botão "+ Novo Estagiário"

### 3.4 Página: Cadastro (`/la-educa/novo`)

Formulário simples, 1 coluna:
- Nome completo (input text, required)
- Unidade (select: Campo Grande / Recreio / Barra da Tijuca)
- Mentor responsável (select com `collaborators` filtrados — quem tem role collaborator+ na mesma unidade)
- Modalidade (radio: Musicalização / Instrumento / Ambos)
- Instrumento (input text — só aparece se modalidade != Musicalização)
- Data de início (input date, default = hoje)
- Diagnóstico de entrada (textarea, opcional)

**Ação ao confirmar:**

```ts
async function cadastrarEstagiario(form: CadastroForm) {
  // 1. INSERT estagiário
  const { data: est, error: e1 } = await supabase
    .from('la_educa_estagiarios')
    .insert({
      nome: form.nome,
      unidade: form.unidade,
      mentor_id: form.mentor_id,
      modalidade: form.modalidade,
      instrumento: form.instrumento || null,
      data_inicio: form.data_inicio,
      diagnostico_entrada: form.diagnostico || null,
    })
    .select('id')
    .single();
  if (e1) throw e1;

  // 2. Selecionar checkpoints aplicáveis pela modalidade
  const filter = form.modalidade === 'ambos'
    ? 'modalidade_filtro.is.null,modalidade_filtro.eq.musicalizacao,modalidade_filtro.eq.instrumento'
    : `modalidade_filtro.is.null,modalidade_filtro.eq.${form.modalidade}`;

  const { data: cps, error: e2 } = await supabase
    .from('la_educa_checkpoints')
    .select('id, pilar')
    .or(filter);
  if (e2) throw e2;

  // 3. INSERT batch das avaliações (uma linha por checkpoint aplicável)
  const { error: e3 } = await supabase.from('la_educa_avaliacoes').insert(
    cps.map(c => ({
      estagiario_id: est.id,
      checkpoint_id: c.id,
      pilar: c.pilar,
    })),
  );
  if (e3) throw e3;

  return est.id; // pra navegar pra /la-educa/:id
}
```

**Resultado esperado:**
- modalidade=musicalizacao → 21 avaliações (16 null + 5 musicalizacao)
- modalidade=instrumento → 21 avaliações (16 null + 5 instrumento)
- modalidade=ambos → 26 avaliações (todas)

### 3.5 Página: Detalhe do estagiário (`/la-educa/:id`)

1. Header com nome + modalidade + mentor + unidade + data início
2. ProgressBar consolidada (puxa da view `la_educa_progresso`)
3. 4 cards de pilar (`PilarCard`):
   - Ícone + nome do pilar
   - X/Y ancorados (ex: "3/6")
   - Badge: Não iniciado / Em andamento / Concluído
   - Clicável → `/la-educa/:id/:pilar`
4. **Botão "Emitir Certificado Alfa"** (só aparece pra coord/director quando `percentual === 100 && !certificado_emitido`):
   - Confirmação modal
   - UPDATE `la_educa_estagiarios SET certificado_emitido=true, certificado_emitido_em=now(), certificado_emitido_por=current_collab_id`
5. Diagnóstico de entrada (collapsible, se preenchido)

### 3.6 Página: Pilar / Avaliação (`/la-educa/:id/:pilar`)

Lista de `CheckpointRow`, cada um com:
- Código + título (ex: "p1.1 — Propriedades do som")
- "O que demonstrar" (descricao) — texto
- "Critério" (criterio) — texto em itálico
- Slider 0–10 step 0.5 (range nativo + display da nota)
- Textarea observações (opcional)
- Status atual: âncora 🟢 se `ancorado=true`, vazio caso contrário
- Botão "Ancorar":
  - Se `nota >= 7`: UPDATE direto (ancorado=true, ancorado_em=now(), avaliado_por=collab_id, nota, observacoes)
  - Se `nota < 7`: abre `JustificativaModal`. Textarea required min 20 chars. Ao confirmar → UPDATE incluindo `justificativa_baixa`

Trigger Supabase grava histórico automaticamente — sem código client.

---

## 4. TOM (backend)

### 4.1 Skill: `skills/la-educa.md`

Triggered quando director/coord pergunta sobre estagiários:
- Regex no system.js: `/(la\s*educa|estagi[áa]rios?|mentoria|trilha\s*de\s*ancoragem)/i`

A skill carrega um bloco com:
- Total de estagiários ativos por unidade
- Top 3 atrasados (>14d sem atualização) com nome + mentor + dias
- Estagiários prontos pra certificar (% = 100 e certificado_emitido = false)
- % médio de progresso por unidade

Tudo lido da view `la_educa_progresso`. Sem markers — TOM só reporta, não age via WhatsApp (mentor avalia direto no PWA).

### 4.2 Dispatcher: `src/rituals/la-educa-lembretes.js`

Agendamento: **toda segunda-feira 09:00 BRT** (via dispatcher.js existente, slot 09:00).

Idempotência: checa `la_educa_lembretes_log` — não reenvia mesmo `tipo + estagiario_id` se já foi enviado nos últimos 6 dias.

3 tipos de lembrete:

**a) `avaliacao_pendente`** (mentor):
- Condição: `ultima_atualizacao < now() - interval '7 days'` AND `percentual < 100`
- Destinatário: `mentor_id`
- Mensagem: lista pilares em andamento com X/Y ancorados

**b) `avaliacao_atrasada`** (coord/director):
- Condição: `ultima_atualizacao < now() - interval '14 days'` AND `percentual < 100`
- Destinatário: todos coordenadores/diretores da unidade do estagiário
- Mensagem: nome do estagiário + mentor + dias parados

**c) `certificado_pronto`** (coord/director):
- Condição: `percentual = 100 AND certificado_emitido = false`
- Destinatário: todos coordenadores/diretores da unidade
- Mensagem: parabenizando + CTA pra emitir certificado

Estrutura do ritual:

```js
// src/rituals/la-educa-lembretes.js
const { supabase } = require('../db');
const whatsapp = require('../services/whatsapp');

async function runLaEducaLembretes() {
  const pending = await fetchPendentes();   // > 7d sem update
  const atrasados = await fetchAtrasados(); // > 14d sem update
  const prontos = await fetchProntos();     // 100% sem cert

  for (const e of pending)   await sendIfNotRecent('avaliacao_pendente', e, e.mentor_id);
  for (const e of atrasados) await sendToCoords('avaliacao_atrasada', e);
  for (const e of prontos)   await sendToCoords('certificado_pronto', e);
}

module.exports = { runLaEducaLembretes };
```

Hook em `dispatcher.js`: depois do bloco do health-report, adicionar bloco:
```js
const LA_EDUCA_TIME = '09:00';
if (now.dow === 1 && now.minute === 0 && timeToSlot(LA_EDUCA_TIME) === slotNow) {
  await runLaEducaLembretes();
}
```

(dow=1 = segunda; gate similar ao health_report pra evitar duplicidade em ticks de 5min).

### 4.3 Realtime sync (PWA)

Adicionar em `web/src/hooks/useRealtimeSync.ts`:
```ts
const WATCHED_TABLES = [
  // ... existentes ...
  'la_educa_estagiarios',
  'la_educa_avaliacoes',
  'la_educa_historico',
  'la_educa_lembretes_log',
];
```
(Checkpoints não precisa — é estático após seed.)

---

## 5. Regras de negócio (consolidadas)

| Regra | Implementação |
|---|---|
| Nota mínima 7,0 pra ancorar sem fricção | Botão "Ancorar" verifica nota → abre JustificativaModal se < 7 |
| Pilares livres (sem bloqueio sequencial) | Todos os PilarCards clicáveis |
| Certificado = ação exclusiva coord/director | Botão só renderiza pra `role in ['coordinator','director']` E `percentual=100` E `!certificado_emitido` |
| Auto-gen de avaliações no cadastro | Client-side, batch INSERT pós-cadastro (snippet em 3.4) |
| Data de ancoragem automática | `ancorado_em` setado no UPDATE |
| Histórico de alterações | Trigger Supabase já existente |
| Visibilidade (mentor só seus, coord da unidade) | RLS no banco (já configurada) |

---

## 6. Critérios de aceite

- [ ] Coord cadastra estagiário e 21/26 avaliações são geradas automaticamente
- [ ] Mentor vê APENAS seus estagiários na lista (RLS valida)
- [ ] Mentor consegue ancorar checkpoint com nota ≥ 7,0 sem fricção
- [ ] Tentar ancorar com nota < 7,0 abre modal exigindo `justificativa_baixa` (min 20 chars)
- [ ] `ancorado_em` é preenchido automaticamente no momento do INSERT/UPDATE
- [ ] `la_educa_historico` é populado automaticamente pelo trigger (NÃO via código client)
- [ ] Coord vê todos os estagiários da unidade + alertas (atrasados / prontos pra cert)
- [ ] Botão "Emitir Certificado Alfa" só aparece quando 100% + ainda não emitido + role coord/director
- [ ] Realtime: qualquer write em `la_educa_*` invalida queries do PWA
- [ ] TOM dispara lembretes segunda 09:00:
  - mentor recebe pendentes (>7d)
  - coord recebe atrasados (>14d)
  - coord recebe prontos-pra-certificar
- [ ] Lembretes não reenviam o mesmo tipo+estagiário em < 6 dias (idempotência via log)
- [ ] Skill TOM responde "como tá o LA EDUCA?" com resumo de estagiários
- [ ] Item "LA EDUCA" aparece em `/mais` (somente pra collaborator/coord/director)

---

## 7. Fora de escopo

- PDF do Certificado Alfa
- Edição/arquivamento de estagiário pelo PWA (faz via SQL por ora)
- Avaliação via WhatsApp (TOM só lembra; mentor avalia no PWA)
- Dashboard de métricas históricas (tempo médio, taxa de aprovação)
- Re-cadastro ao mudar modalidade (coord arquiva e cria novo manualmente)

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Auto-gen do `ambos` traz checkpoints duplicados | UNIQUE constraint `(estagiario_id, checkpoint_id)` já existe → INSERT falha barulhento se duplicar |
| Mentor tenta ancorar checkpoint que não é dele | RLS no banco rejeita (write policy via JOIN estagiários) |
| Lembrete TOM dispara várias vezes no mesmo dia | Gate `now.minute === 0` + idempotência via `la_educa_lembretes_log` |
| RLS bloqueia leitura legítima do mentor | Testar com login de teste antes de subir |
| Realtime + invalidateQueries() trigger storm | Já é o padrão do app; aceito (single-user, time pequeno) |
