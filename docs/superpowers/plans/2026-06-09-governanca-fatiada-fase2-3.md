# Governança fatiada — Sub-fases 2 (voz TOM) + 3 (PWA) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps usam checkbox (`- [ ]`).

**Goal:** (2) Um líder re-delega a cobrança por voz no WhatsApp ("isso é da Rose") e o TOM muda `governance_owner_id` da tarefa. (3) No PWA, a visão do líder filtra tarefas pela posse e um botão "Passar cobrança pra…" muda `governance_owner_id`.

**Architecture:** Sub-fase 2 estende o marker `TASK_UPDATE` com a action `governance_reassign` (reusa parse/validação/anti-mentira). Skill nova ensina o LLM a emiti-la usando o `[id=...]` já presente no contexto. Handler resolve o novo dono via `resolveCollaboratorByName` (pessoa) ou `governance_leaders` (departamento), com guard de autorização. Sub-fase 3 adiciona `governance_owner_id` ao snapshot do time, filtra por `governanceViewerIdsOf` (já existe, sem uso), e clona `DelegateTaskSheet` em `TransferGovernanceSheet`.

**Tech Stack:** Node CommonJS (`src/engine.js`, `skills/`, `prompts/system.js`), TypeScript PWA (`web/src`), Supabase.

**Spec:** `docs/superpowers/specs/2026-06-09-governanca-fatiada-por-delegacao-design.md` (sub-fases 2 e 3 já aprovadas).

**Workflow do repo:** SEM git commit por task (auto-deploy hook). TOM (`src/`, `skills/`) sobe por SCP + `pm2 restart`. PWA (`web/`) sobe no auto-deploy ao fim do turno.

---

## SUB-FASE 2 — Re-delegação por voz no TOM

### Task 1: Skill `governanca-redelegacao.md` + loader

**Files:**
- Create: `skills/governanca-redelegacao.md`
- Modify: `src/prompts/system.js` (bloco de governança, ~L.943-946, onde já carrega `governanca-sanitizar`/`diagnosticar`/`escalar` quando `collab.role === 'director'` + `GOV_RE`)

- [ ] **Step 1: Escrever a skill**

Criar `skills/governanca-redelegacao.md` com conteúdo (adaptar ao estilo das outras skills de governança):

```markdown
# Governança — Re-delegar cobrança (mudar o dono da cobrança)

Quando um LÍDER, falando de uma tarefa específica que está na governança dele, diz que aquela
cobrança é de OUTRA pessoa/departamento — ex.: "isso é da Rose", "essa daí é do financeiro",
"manda pro Jereh cobrar", "quem cobra isso é a Krissya" — você deve REPASSAR a posse da cobrança.

Isso NÃO muda quem executa a tarefa (assigned_to). Muda só QUEM COBRA (governance_owner_id).

## Como fazer
Use o marker TASK_UPDATE com action "governance_reassign":

<<TASK_UPDATE>>
{ "action": "governance_reassign", "id": "<short-id da tarefa>", "to_name": "<pessoa ou departamento>" }
<<END>>

- `id`: use EXATAMENTE o [id=...] que aparece ao lado da tarefa no contexto/digest. Nunca invente.
- `to_name`: o nome da pessoa ("Rose") OU o departamento ("financeiro", "comercial", "pedagógico").

## Regras
- Só re-delegue se o líder estiver claramente dizendo que a COBRANÇA é de outra pessoa. Se for
  dúvida ("será que isso é da Rose?"), pergunte antes, não emita o marker.
- Se você não tem o [id=...] daquela tarefa no contexto, peça pro líder dizer qual tarefa (ou o id).
- Depois de emitir, confirme em 1 linha: "Pronto, repassei a cobrança de _<tarefa>_ pra <Novo dono>. Some do seu painel."
- Se o engine devolver erro (sem permissão / pessoa não encontrada / departamento sem líder), explique
  com naturalidade e não tente de novo no chute.
```

- [ ] **Step 2: Carregar a skill no system prompt**

Em `src/prompts/system.js`, no MESMO bloco condicional que já carrega as 3 skills de governança (procurar `loadSkill('governanca-escalar')` ou `governanca-diagnosticar`), adicionar:
```js
    govBlock += '\n\n' + loadSkill('governanca-redelegacao');
```
(usar o mesmo padrão de concatenação/variável que as skills vizinhas usam — ler o trecho real antes de editar; a variável pode ter outro nome).

- [ ] **Step 3: Syntax check**
Run: `cd /d/la-organizer/_remote && node --check src/prompts/system.js` → sem erro.

---

### Task 2: Action `governance_reassign` no engine (validação + handler)

**Files:**
- Modify: `src/engine.js` — `VALID_TASK_ACTIONS` (~L.108-111); validação em `parseTaskUpdateMarker`/`validateTaskAction` (~L.3230, ramo `delegate`); handler novo (perto do bloco `delegate` ~L.4587-4673).

- [ ] **Step 1: Adicionar a action à allowlist**

Em `VALID_TASK_ACTIONS` (~L.108), incluir `'governance_reassign'` na lista (Set/array).

- [ ] **Step 2: Validar a action no parser**

No ponto onde as actions são validadas (mesmo lugar que valida `delegate` exigindo `to_name`/`to_phone`), aceitar `governance_reassign` exigindo `id` (short-id) + (`to_name` OU `to_phone`). Sem exigir `assigned_to`. Reusar o regex `SHORT_ID_RE` (L.107) pra validar o id.

- [ ] **Step 3: Handler do `governance_reassign`**

Adicionar um ramo (perto do handler `delegate`). Pseudo-código exato a implementar:

```js
if (a.action === 'governance_reassign') {
  // 1. Resolver a tarefa pelo short-id (SEM filtrar por assigned_to — o re-delegador
  //    normalmente é o dono da cobrança, não o executor). Buscar id que comece com a.id.
  const { data: tk } = await supabase
    .from('tasks')
    .select('id, title, assigned_to, governance_owner_id, context, status')
    .ilike('id', `${a.id}%`)
    .limit(2);
  if (!tk || tk.length === 0) { /* responde "não achei essa tarefa" via resultado de erro */ }
  if (tk.length > 1) { /* ambíguo: pede o id completo */ }
  const task = tk[0];

  // 2. Autorização: só pode re-delegar quem é DONO da cobrança hoje, ou director,
  //    ou (se posse NULL) o gerente da unidade do executor.
  const ownerCollab = collabById ? collabById.get(task.assigned_to) : null; // se não houver, buscar
  const isDirector = collaborator.role === 'director';
  const isCurrentOwner = task.governance_owner_id && task.governance_owner_id === collaborator.id;
  const isUnitMgrOfLoose = !task.governance_owner_id && ownerCollab &&
        collaborator.role === 'manager' && collaborator.unit && ownerCollab.unit === collaborator.unit;
  if (!isDirector && !isCurrentOwner && !isUnitMgrOfLoose) {
    /* erro: "essa cobrança não está com você, não dá pra repassar" */
  }

  // 3. Resolver o novo dono. Primeiro tenta pessoa; se não achar e o termo for um
  //    departamento conhecido, tenta governance_leaders.
  const resolved = await resolveCollaboratorByName(a.to_name, { requester: collaborator });
  let newOwnerId = null, newOwnerName = null;
  if (resolved && resolved.status === 'ok' && resolved.collaborator) {
    newOwnerId = resolved.collaborator.id; newOwnerName = resolved.collaborator.full_name;
  } else {
    // Fallback departamento: governance_leaders group_key ~ a.to_name (normalizado)
    const grp = normalizeGroupKey(a.to_name); // 'financeiro','comercial','pedagogico','marketing','operacoes','sucesso_cliente','farmer'
    if (grp) {
      const { data: gl } = await supabase.from('governance_leaders')
        .select('leader_id, collaborators!governance_leaders_leader_id_fkey(full_name)')
        .eq('group_key', grp).limit(1);
      if (gl && gl[0]) { newOwnerId = gl[0].leader_id; newOwnerName = gl[0].collaborators?.full_name; }
    }
  }
  if (!newOwnerId) { /* erro: "não achei <to_name> pra repassar — me diz o nome certo" */ }
  if (newOwnerId === task.assigned_to) { /* aviso: o novo dono é a própria pessoa que executa — confirma? mas pode prosseguir */ }

  // 4. Atualizar a posse.
  await supabase.from('tasks').update({ governance_owner_id: newOwnerId }).eq('id', task.id);

  // 5. Resultado de sucesso → o LLM/engine confirma "repassei a cobrança de X pra Y".
  //    (seguir o padrão de retorno dos outros handlers de TASK_UPDATE: push num array de
  //     resultados/confirmrações que o engine usa pra montar a resposta.)
}
```

IMPORTANTE: ler o handler `delegate` real (~L.4587) pra COPIAR o padrão de: (a) como o handler recebe `a` (a action parseada), `collaborator`/`collab`, `supabase`; (b) como ele empurra confirmação/erro pro fluxo de resposta (não inventar um padrão novo — espelhar o existente); (c) se há logging tipo `marker_logs`/`logMarker`, replicar com `marker_type:'task_update'` action governance_reassign. `normalizeGroupKey` pode ser um helper local simples (mapa de sinônimos → group_key) definido no próprio arquivo se não existir.

- [ ] **Step 4: Syntax check**
Run: `cd /d/la-organizer/_remote && node --check src/engine.js` → sem erro.

- [ ] **Step 5: Deploy TOM (SCP + restart)**
```bash
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp /d/la-organizer/_remote/skills/governanca-redelegacao.md tom:/opt/LA-Organizer/skills/governanca-redelegacao.md
ssh tom "pm2 restart tom && echo RESTARTED"
```

---

### Task 3: Validação Sub-fase 2 (dry-run direto do handler na VPS)

**Files:** nenhum (validação).

- [ ] **Step 1: Teste de autorização + reassign com dado real (sem mexer em prod de verdade)**

Achar (via MCP Supabase) uma tarefa de teste OU criar uma com `data_classification='test'`, com `governance_owner_id` = um líder L1 e `assigned_to` = uma pessoa P. Simular na VPS a chamada do caminho de update (ou via SQL conferir o efeito do handler). Como o handler depende do fluxo de marker, o teste mínimo seguro é:
```bash
# Conferir que resolveCollaboratorByName resolve "Rose" e o update muda só governance_owner_id.
ssh tom 'cd /opt/LA-Organizer && node --env-file=.env -e '"'"'
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
  // cria task de teste, aplica update de posse, confere, apaga
  const ins = await sb.from("tasks").insert({ title:"TEST redeleg", context:"work", status:"pending",
    data_classification:"test", assigned_to:"<P_ID>", governance_owner_id:"<L1_ID>", due_date:"2026-06-01" }).select("id").single();
  const id = ins.data.id;
  await sb.from("tasks").update({ governance_owner_id:"<L2_ID>" }).eq("id", id);
  const chk = await sb.from("tasks").select("assigned_to, governance_owner_id").eq("id", id).single();
  console.log("assigned_to intacto:", chk.data.assigned_to === "<P_ID>", "| nova posse:", chk.data.governance_owner_id === "<L2_ID>");
  await sb.from("tasks").delete().eq("id", id);
  console.log("limpo");
})().catch(e=>console.error("ERR", e.message));
'"'"''
```
Esperado: `assigned_to intacto: true | nova posse: true` e `limpo`. Apagar a linha de teste no fim (é `data_classification='test'`, permitido).

- [ ] **Step 2: Smoke do system prompt carregando a skill**

```bash
ssh tom 'cd /opt/LA-Organizer && node --env-file=.env -e '"'"'
const fs=require("fs"); const p="./skills/governanca-redelegacao.md";
console.log("skill existe:", fs.existsSync(p));
'"'"''
```
Esperado: `skill existe: true`. (O carregamento real depende do gate director+GOV_RE; conferir que o `node --check system.js` passou já garante a sintaxe.)

---

## SUB-FASE 3 — PWA: filtro por posse + botão "Passar cobrança pra…"

### Task 4: Snapshot do time inclui e filtra por posse

**Files:**
- Modify: `web/src/lib/team-snapshot.ts` (query `overdueQ` ~L.109-118; filtro após `filterActiveAssignees` ~L.120)

- [ ] **Step 1: Adicionar `governance_owner_id` ao select**

Em `fetchTeamSnapshot`, na query `overdueQ` (~L.110), adicionar `governance_owner_id` à lista do `.select('id, title, assigned_to, due_date, ...')`.

- [ ] **Step 2: Filtrar as atrasadas pela posse quando o viewer NÃO é CEO**

Após carregar as tarefas e ter `allCollabs`, filtrar usando a função pura já existente. Importar no topo: `import { governanceViewerIdsOf } from './team-routing';`. Onde hoje as overdue são contabilizadas, inserir (só quando o viewer não é CEO — o CEO vê tudo):
```ts
const viewer = allCollabs.find((c) => c.id === myId);
const isCeo = !!(viewer && (viewer as any).is_ceo);
const scopedOverdue = isCeo
  ? overdueTasks
  : overdueTasks.filter((t) =>
      governanceViewerIdsOf(
        { governance_owner_id: (t as any).governance_owner_id ?? null, assigned_to: t.assigned_to },
        allCollabs.find((c) => c.id === t.assigned_to),
        allCollabs,
      ).includes(myId),
    );
```
e usar `scopedOverdue` no lugar de `overdueTasks` para as contagens por pessoa (`overdueByPerson`/`overdueCount`). NÃO alterar a visão do CEO (continua somando tudo). Ler o código real pra casar os nomes de variáveis (`overdueTasks` pode ter outro nome).

- [ ] **Step 3: tsc + build**
Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit` → exit 0.

---

### Task 5: `TransferGovernanceSheet` + botão no card de tarefa (`/time/:id`)

**Files:**
- Create: `web/src/components/team/TransferGovernanceSheet.tsx` (clone enxuto de `web/src/components/DelegateTaskSheet.tsx`)
- Modify: a tela/itens de tarefa da pessoa em `/time/:id` — achar onde cada tarefa atrasada da pessoa é renderizada (provável `TeamDrillPanel.tsx` ou a página `/time/:id`; o implementer deve localizar o render da tarefa individual e onde cabe um botão/ação).

- [ ] **Step 1: Criar `TransferGovernanceSheet.tsx`**

Clonar o padrão de `DelegateTaskSheet.tsx` (BottomSheet + CustomSelect + Button + useMutation). Diferenças:
- Título: "Passar cobrança pra…"
- Options do CustomSelect = LÍDERES: `allCollabs.filter(c => ['manager','coordinator','director'].includes(c.role))` (ou `resolveLeadersOf(taskOwner, allCollabs)` se quiser só os líderes daquele dono — começar com a lista de líderes geral é aceitável). Label = nome; sublabel = unidade/função.
- onConfirm: `await supabase.from('tasks').update({ governance_owner_id: newLeaderId }).eq('id', task.id).select('id');` depois `qc.invalidateQueries({queryKey:['tasks']})` + `qc.invalidateQueries({queryKey:['team-snapshot']})`.
- Props: `{ task, allCollabs, open, onClose }`. Usar `useAuth().collaborator` se precisar do viewer.
- Usar SOMENTE design system (BottomSheet, CustomSelect, Button) — nunca HTML nativo.

- [ ] **Step 2: Plugar o botão no card de tarefa da pessoa**

Na renderização de cada tarefa individual em `/time/:id` (localizar), adicionar um `<Button variant="ghost" size="sm">Passar cobrança</Button>` que abre o `TransferGovernanceSheet` para aquela task. Estado local `const [transferTask, setTransferTask] = useState(null)`.

- [ ] **Step 3: tsc + build**
Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build` → ambos exit 0.

---

### Task 6: Validação visual no Preview (PWA)

**Files:** nenhum.

- [ ] **Step 1:** Preview em `localhost:4173` (já roda). Navegar pra `/time` como líder e `/time/:id` de um liderado; confirmar o botão "Passar cobrança" abre o sheet, lista líderes, e o update funciona (a tarefa some/troca de dono após confirmar). Usar `mcp__Claude_Preview__preview_eval` + `preview_screenshot` com o snippet de limpeza de SW cache. (Se o login do preview expirou, reportar e deixar pro Alf validar pós-deploy Vercel.)

---

## STATUS: ✅ ENTREGUE (09/06/2026)

Sub-fase 2 (TOM) e Sub-fase 3 (PWA) implementadas via subagent-driven (Sonnet impl / verificação Opus+controlador). TOM deployado por SCP+restart; PWA sobe no auto-deploy (Vercel). **Bug crítico pego e corrigido:** o handler usava `.ilike('id',...)`/`.filter('id::text',...)` numa coluna uuid → erro `operator does not exist: uuid ~~*` no PostgREST. Fix: resolver short-id via `matchRowsByShortId` (busca pending+work, filtra em JS — padrão canônico de `resolveTaskByShortId`). Validado na VPS: short-id match OK; `resolveCollaboratorByName` resolve Krissya/Jereh/Gabi. **Pendência de CONTEÚDO (não-código):** Rose e o grupo `financeiro` não estão cadastrados → "isso é da Rose"/"manda pro financeiro" dão not_found até cadastrar. Demo: usar nomes que existem.

## Self-Review (feito)
- **Cobertura da spec:** re-delegação por voz (TOM, sub-fase 2) = Tasks 1-3; PWA filtro + botão (sub-fase 3) = Tasks 4-6. ✓
- **Autorização (segurança):** o handler só permite reassign por director / dono atual da cobrança / gerente da unidade (posse NULL). Evita um liderado qualquer reassign. `assigned_to` nunca muda (só `governance_owner_id`). ✓
- **Reuso:** TASK_UPDATE estendido (não marker novo); DelegateTaskSheet clonado; governanceViewerIdsOf já pronto. ✓
- **Riscos demo:** PWA é determinístico (sem LLM). Voz depende do LLM capturar o [id=...] — a skill instrui a usar o id exato e a pedir o id se não tiver. ✓
- **Placeholders:** os ids reais (`<P_ID>`/`<L1_ID>`/`<L2_ID>`) na Task 3 são preenchidos na hora (dependem do banco). Demais passos têm código/comando reais.
