# Auditoria de Arquitetura — Fatia B: skills/ + soul/ (documentação viva → prompt do TOM)

Escopo: `D:\la-organizer\_remote\skills\` (64 arquivos .md, 9.395 linhas), `D:\la-organizer\_remote\soul\`
(6 arquivos, 1.376 linhas), carregamento em `D:\la-organizer\_remote\src\prompts\system.js` (3.880 linhas),
cruzado com o parser de markers em `D:\la-organizer\_remote\src\engine.js` (14.671 linhas). Auditoria
100% leitura — nenhum arquivo foi alterado.

---

## 1. DIVERGÊNCIA DOC ↔ CÓDIGO (a mais grave)

### 1.A — `<<DND_UPDATE>>` não existe no código; o marker real é `<<DND_SET>>`

- `src/prompts/system.js:~103` (dentro de `BLOCK_RULES`, **hardcoded, carregado em TODO turno**) lista
  na "MARKERS VÁLIDOS — lista canônica": `` `<<DND_UPDATE>>` ``.
- `src/engine.js:3577-3579` — o único parser de DND é `parseDndMarker`, regex
  `/<<DND_SET>>\s*([\s\S]*?)\s*<<END>>/i`. Não existe NENHUM parser para `DND_UPDATE` em todo o
  `engine.js` (grep vazio).
- `skills/pausa-temporaria.md` ensina corretamente `DND_SET`.
- **Efeito**: se o LLM confiar na lista canônica de `BLOCK_RULES` (que é a MESMA lista que declara
  "markers hallucinated" a evitar) e emitir `<<DND_UPDATE>>`, o marker cai no catch-all
  `UNKNOWN_MARKER_STRIPPED` — rejeição garantida, silenciosa.

### 1.B — `TASK_UPDATE action="approve"/"deny"` não existe; ação real é `extension_decision`

- `src/prompts/system.js:~103` — mesma lista canônica documenta:
  `` `<<TASK_UPDATE>>` (com action: create/complete/reschedule/delegate/extension_request/**approve/deny**) ``.
- `src/engine.js:172-177` — `VALID_TASK_ACTIONS` = `{complete, cancel, reschedule, create, delegate,
  extension_request, extension_decision, governance_reassign, snooze_reminders, return, mark-item,
  mark_item}`. **Não existe ação `approve` nem `deny`.**
- `src/engine.js:3610` — `validateTaskAction`: `if (!VALID_TASK_ACTIONS.has(a.action)) return
  'unknown_action'` — qualquer `action:"approve"`/`"deny"` é rejeitado na primeira linha de validação.
- A ação real para aprovar/negar prazo é `extension_decision` com campo booleano `approved` (ver 1.C).

### 1.C — `extension_decision`: skill ensina campo errado (`decision`) e omite campo obrigatório (`new_due_date`)

- `skills/checklist-tarefas.md:547` ensina: `` {"action":"extension_decision","id":"<8-char>","decision":"approved|denied"} ``.
- `src/engine.js:3674-3678` (`validateTaskAction`) exige o campo **`approved`** (boolean ou string
  `'true'`/`'false'`), NÃO `decision`:
  ```
  if (typeof a.approved !== 'boolean' && a.approved !== 'true' && a.approved !== 'false') return 'approved_not_bool';
  const isApproved = a.approved === true || a.approved === 'true';
  if (isApproved && (typeof a.new_due_date !== 'string' || !ISO_DATE_RE.test(a.new_due_date))) return 'approved_needs_date';
  ```
- Como a skill nunca ensina o campo `approved` nem `new_due_date`, **seguir a skill à risca produz
  rejeição garantida** (`approved_not_bool`). Esta é a única skill que ensina `extension_decision` —
  não há atalho para o LLM acertar por acaso. Forte candidato a contribuir para os 14,1% de
  `TASK_UPDATE` rejeitado.

### 1.D — Lista canônica de markers em `BLOCK_RULES` está desatualizada (drift interno)

`BLOCK_RULES` (system.js, hardcoded, sempre carregado) enumera os markers válidos mas **omite**
markers reais, ativamente parseados pelo engine e ensinados por skills carregadas:
- `PREFS_UPDATE` (`engine.js:4117`) — e o mais irônico: as próprias Regras 17/18/18b do **mesmo bloco
  BLOCK_RULES**, algumas linhas abaixo da lista, mandam emitir `<<PREFS_UPDATE>>` explicitamente.
- `COORDINATION_REQUEST` / `COORDINATION_RESPONSE` (`engine.js:1543,1606`)
- `FINANCE_ACTION` (`engine.js:7445,7469`)
- `DATA_CLASSIFY` (`engine.js:327`)

Não chega a causar rejeição (as skills contextuais ensinam o nome certo quando carregadas), mas é
uma lista que se pretende "canônica" e já não é — quem confiar nela para saber "o que existe" é
enganado por omissão.

### 1.E — Preferências de silêncio (`quiet_hours`): skill viva ensina campo LEGADO que o próprio `BLOCK_RULES` proíbe, e o engine aceita silenciosamente sem efeito (bug tipo "confab" que não aparece como rejeição)

- `skills/configurar-preferencias.md:55-56,142,150,162` (**carregada para TODO collaborator em TODO
  turno** — `system.js:3091-3096`, gate é só `if (collaborator)`) ensina o schema:
  `` { "quiet_start_time": "HH:MM", "quiet_end_time": "HH:MM" } `` (colunas GLOBAIS, sem sufixo).
- `src/prompts/system.js:~123` (Regra 18 de `BLOCK_RULES`, MESMO prompt, sempre junto): **"NÃO use
  `quiet_start_time`/`quiet_end_time` globais — legado"** e manda usar
  `quiet_start_time_work`/`_personal`.
- `src/engine.js:4182-4187` (`parsePrefsMarker`) **aceita e persiste** `quiet_start_time`/`quiet_end_time`
  bare sem NENHUM erro/rejeição — não há aviso de "campo legado".
- `src/services/quiet-hours.js:75-94` (`windowFor`) — quando o registro de preferências buscado tem as
  colunas de contexto presentes (`_work`/`_personal`, o que acontece sempre que o caller usa a lista
  canônica `QUIET_PREF_COLUMNS`, linha 26-31, que sempre inclui ambos os conjuntos), o valor da coluna
  **global antiga é ignorado** em favor do valor (possivelmente `null`) da coluna por contexto.
- **Efeito real**: o marker "funciona" do ponto de vista do engine (sem erro, sem rejeição, TOM
  confirma "beleza, configurado"), mas a leitura de verdade (dispatcher/quiet-hours) não enxerga a
  gravação — o pedido do usuário não tem efeito nenhum. Isso é uma classe de bug **pior** que
  rejeição: não aparece em métrica de "marker rejeitado" porque tecnicamente nada falhou — é
  confabulação estrutural via schema obsoleto, exatamente o padrão descrito como raiz das 34
  confabulações históricas, só que na camada de schema em vez de instrução de "confirme sem marker".
- `skills/preferencias-horario.md:17,33,40` ensina o MESMO campo legado — mas este arquivo está
  **órfão** (nunca carregado, ver seção 4), então não contribui ao vivo; é evidência de que o legado
  nunca foi corrigido em nenhuma das duas cópias quando o schema migrou para contexto (Sprint
  ContextPrefs / PREFS-DND-ROUTE).

### 1.F — `skills/inventario.md` nunca é carregado; o LLM recebe 1 frase solta em vez do skill inteiro

- `system.js:3613` injeta apenas: `` "Quando o usuário descrever uma ação operacional, use a skill
  inventario.md e emita <<INVENTORY_ACTION>>...<<END>> com JSON estruturado. Sempre confirmar antes de
  gravar." `` — uma única linha de texto, sem nenhum campo, ação ou enum.
- Busca exaustiva (`grep -rn "inventario.md\|loadSkill('inventario')" src/`) confirma: **nenhum lugar
  do código faz `fs.readFileSync`/`loadSkill` de `skills/inventario.md`** (174 linhas de schema real:
  colunas, ações, fluxo). O handler de `INVENTORY_ACTION` no engine (`src/engine.js:11353-11865`, ~500
  linhas, múltiplas ações e validações) não tem nenhuma contraparte de ensino chegando ao modelo.
- `scripts/smoke-inventario-trigger.js:25` — o teste de fumaça que deveria pegar isso checa
  `systemPrompt.includes('inventario.md')` **como substring literal** — passa verde porque a frase
  solta contém o texto "inventario.md", mascarando que o conteúdo real nunca chega.

### 1.G — `<<CHECKPOINT_BATCH>>` tem apenas ensino parcial; seu skill dedicado está órfão

- `skills/criar-checkpoint.md` (213 linhas) é o único arquivo dedicado a ensinar checkpoints de
  projeto — e está **órfão** (nunca carregado, ver seção 4), apesar de `CHECKPOINT_BATCH` ser marker
  real e parseado (`engine.js:500-553`).
- O único ensino que de fato chega ao modelo vem de `skills/priorizacao-inteligente.md` (skill
  auxiliar, só carregada quando a skill primária é `checklist-tarefas`, `criar-compromisso` ou
  `cadastro-projeto-5w2h` — `system.js:2777-2785`), com cobertura bem mais rasa (1 linha de "veto"
  em vez de 213 linhas de fluxo/schema).

### 1.H — Perda silenciosa de blocos repetidos do mesmo marker (parser não-global)

- Os parsers de marker em `engine.js` usam regex **sem flag global** (`text.match(re)`, não
  `matchAll`) — ex. `parseEventCreateMarker` (`engine.js:2263-2265`), `parseTaskUpdateMarker`
  (`engine.js:436-438`). Um segundo bloco `<<EVENT_CREATE>>...<<END>>` na mesma resposta é
  descartado como `UNKNOWN_MARKER_STRIPPED` (confirmado em `engine.js:12468-12491`).
- `skills/checklist-tarefas.md:19` e `skills/lista-mental.md` (órfã) alertam explicitamente sobre
  isso e mandam usar UM array dentro de UM bloco.
- `skills/criar-compromisso.md` (**sempre carregada**, 380 linhas) **não tem esse alerta em nenhum
  lugar** (grep vazio por "UNKNOWN_MARKER_STRIPPED"/"um bloco só"/"múltiplos blocos").
- `BLOCK_RULES` Regra 5b (`system.js`, sempre carregado) diz: "Pode emitir VÁRIOS markers numa
  resposta só (vários itens dentro de um `<<TASK_UPDATE>>`, mais `<<EVENT_CREATE>>`, etc.). NÃO
  existe 'um por turno'." — a frase é ambígua o bastante para o LLM interpretar "vários markers" como
  "vários blocos do mesmo tipo", que é exatamente o padrão que o parser descarta silenciosamente.
  Candidato forte para explicar parte dos 16,7% de rejeição de `EVENT_CREATE` em cenários de
  "descarga de múltiplas demandas" (que a própria Regra 5b existe para tratar).

### Controle positivo (nem tudo diverge)

- `ANNOUNCEMENT_APPROVAL` (`skills/aprovacao-comunicados.md:46` vs `engine.js:864-889`) e
  `EVENT_UPDATE` (`skills/criar-compromisso.md:351-367` vs `engine.js:2702-2741`) estão bem alinhados
  — mesmos nomes de campo, mesmos requisitos. Cito para deixar claro que a auditoria não é "tudo
  quebrado" — os pontos acima são divergências reais, não ruído de leitura.
- `EVENT_CREATE` "core" (title/start_at/end_at, `skills/criar-compromisso.md:170-184` vs
  `engine.js:2216-2259`) também bate. A única lacuna real ali é a regra 1.H (multi-bloco) e o fato de
  a skill tratar `modality`/`category` como **obrigatórios e bloqueantes** ("nunca emita sem…",
  linha 245) quando o engine na verdade **preenche default silenciosamente** para ambos
  (`engine.js:2228-2230,2237-2243`) — não é uma causa de rejeição, mas é uma skill mais rígida do
  que o código exige (gera perguntas ao usuário que o engine não obrigaria).

---

## 2. INSTRUÇÕES QUE INDUZEM MENTIRA

Busquei exaustivamente por padrões de "confirme em texto sem marker" e "promessa futura sem
mecanismo" em `skills/*.md` e `soul/*.md`. **Resultado, ao contrário do esperado: não encontrei
nenhuma instrução nova do mesmo tipo do bug histórico das 34 confabulações.** O que existe é o
oposto — o reparo daquele bug foi propagado amplamente: pelo menos 15 arquivos (`anotacoes.md`,
`comunicados.md`, `coordenacao-conversacional.md`, `criar-compromisso.md`, `financeiro-pessoal.md`
(com um bloco em destaque "🚨 O PIOR ERRO POSSÍVEL"), `gerencia.md`, `governanca-redelegacao.md`,
`habitos-pessoais.md`, `lembrete-recorrente.md`, `lista-mental.md` (órfã), `operacoes-tecnicas.md`,
`planejamento-mensal.md`, `preferencias-voz.md`, `priorizacao-inteligente.md`, `tratamento-audio.md`)
têm avisos explícitos "NUNCA confirme/diga que fez sem emitir o marker na mesma resposta", vários
citando o incidente que motivou a regra.

O único "sem marker" que encontrei (`skills/lista-mental.md:332`) é legítimo: é o caso em que o
usuário já resolveu um conflito de duplicata escolhendo "usar a tarefa existente" — não há nada novo
para persistir, então "confirme em texto" está correto (mas note: `lista-mental.md` está órfã, então
essa instrução nem chega ao modelo hoje).

**Ressalva importante**: a divergência 1.E (quiet-hours) é funcionalmente uma mentira estrutural —
TOM confirma sucesso honestamente (achando que emitiu o marker certo, e emitiu), mas o efeito real é
nulo por causa do schema legado. Nenhuma quantidade de "regra anti-mentira" no texto do prompt
resolve isso, porque a mentira nasce da divergência de schema, não da ausência de marker. Recomendo
tratar como bug de código (deprecar/rejeitar as colunas globais no `parsePrefsMarker`) mais do que
como ajuste de skill.

---

## 3. CONTRADIÇÃO E SOBREPOSIÇÃO ENTRE SKILLS

- **Quiet hours duplicado e obsoleto em 2 arquivos** — `configurar-preferencias.md` (viva) e
  `preferencias-horario.md` (órfã) ensinam a mesma coisa (schema legado de silêncio), e nenhuma das
  duas foi atualizada quando o schema migrou para colunas por contexto (`_work`/`_personal`). Repetição
  que já drifta, exatamente o padrão descrito no brief.
- **`CHECKLIST_ACTION` (checklists operacionais) ensinado em 2 lugares com profundidade muito
  diferente** — `skills/checklist-tarefas.md:675-710` tem uma versão resumida (~35 linhas: como
  interpretar resposta + formato do marker) embutida no final do maior skill do repo; o arquivo
  dedicado e mais completo `skills/checklists-operacionais.md` (252 linhas, cobre 5 subfluxos: enviar
  checklist, registrar, **captar problema observado durante o checklist**, lembrar pendência,
  **reportar aderência pra liderança**) está **órfão** — nunca carregado. Ou seja: o fluxo de
  "reportar problema"/"aderência" que só existe no arquivo completo nunca chega ao LLM; só a versão
  truncada embutida em `checklist-tarefas.md` está ativa.
- **Lista canônica de markers (`BLOCK_RULES`) contradiz as próprias regras do mesmo bloco** — ver 1.D.
- Não encontrei contradição direta de **regra de negócio** (ex.: duas skills mandando ações opostas
  para o mesmo gatilho) nas skills que efetivamente competem por primazia em `pickSkill` — o roteamento
  em `system.js:923-1409` já resolve a maioria dos conflitos de prioridade com comentários explícitos
  de por que uma skill vem antes da outra (ex.: financeiro antes de recorrência, recorrência antes de
  hábito, projeto-grande antes de compromisso). Isso é bom sinal de manutenção deliberada — mas
  também significa que qualquer novo gatilho ambíguo cai numa cadeia de regex já bem carregada e
  frágil (17+ blocos de prioridade em sequência).

---

## 4. SKILL ÓRFÃ / SEMPRE-CARREGADA

### Órfãs confirmadas (18 de 64 arquivos — ~24,8% das 9.395 linhas do diretório nunca chegam a nenhum prompt)

Verificação: para cada um dos 64 `skills/*.md`, busquei `loadSkill('<nome>')` e
`path.join(SKILLS_DIR, '<nome>.md')` em `system.js`, depois confirmei com grep no `src/` inteiro e no
repo inteiro que o nome do arquivo não aparece em nenhum outro carregador. Zero ocorrências para:

| Skill órfã | Linhas | Observação |
|---|---|---|
| `lista-mental.md` | 337 | 3º maior arquivo do diretório; fluxo de "mental dump" em lote com boas regras anti-confab que nunca chegam ao modelo |
| `checklists-operacionais.md` | 252 | versão completa do fluxo, substituída por resumo embutido em `checklist-tarefas.md` (ver seção 3) |
| `broadcast.md` | 224 | grep de "broadcast" no código bate só na FEATURE de broadcast (dispatcher/announcements), nunca no arquivo .md |
| `integracao-emusys.md` | 216 | |
| `criar-checkpoint.md` | 213 | único professor completo de `CHECKPOINT_BATCH` (marker real, ver 1.G) |
| `planejamento-mensal.md` | 196 | |
| `inventario.md` | 174 | ver 1.F — só 1 frase solta chega ao modelo |
| `fechamento-mensal.md` | 172 | |
| `gestao-memoria.md` | 87 | |
| `lembrete-prazo.md` | 86 | reação a lembrete automático de prazo de checkpoint — sem essa skill, resposta do colaborador ao lembrete não tem guia nenhum |
| `la-journey.md` | 84 | "la-journey" no código refere-se à FEATURE (progresso de curso), não ao arquivo — confirmado por grep dedicado |
| `auditoria-sistema.md` | 72 | consumiria o bloco `[HEALTH_CHECK_LAST_RUN]` citado em comentário (`system.js:2757`) mas nunca é carregada |
| `checklists-tarefa-derivada.md` | 40 | |
| `pesquisa-preco.md` | 35 | |
| `checklists-justificar.md` | 35 | |
| `preferencias-horario.md` | 57 | ver 1.E/3 — mesmo conteúdo obsoleto que a skill viva |
| `checklists-anexo.md` | 27 | |
| `governanca-dados.md` | 19 | |

Também há 3 arquivos de sujeira no diretório (não contam nas 64, extensão não é `.md` puro):
`onboarding.md.save`, `onboarding.md.save.1`, `priorizacao-inteligente.md.vps` — sobras de backup
manual que não são carregadas (extensão não bate o glob), mas poluem o diretório e podem confundir
quem for editar (achar que está editando a skill viva).

### Sempre-carregadas (custo de contexto em todo turno, independente do assunto)

Confirmado em `system.js` que os seguintes são incondicionais (ou quase — apenas `if (collaborator)`,
sem checar tópico da mensagem):

- `integridade-agenda.md` (126 linhas) — `system.js:2798-2803`, comentário próprio diz "sempre
  carregada para todos os roles".
- `criar-compromisso.md` (380 linhas!) — `system.js:2805-2810`, "sempre carregada... não
  condicional", só pula se já for a skill primária.
- `reagir-mensagens.md` (103 linhas) — `system.js:3145-3149`, gate é só `if (collaborator)`.
- `coach-usabilidade.md` (110 linhas) — `system.js:3151-3157`, mesmo gate.
- `configurar-preferencias.md` (199 linhas) — `system.js:3091-3096`, mesmo gate.
- `responder-por-audio.md` (83 linhas) — condicional a `TOM_VOICE_ENABLED`, mas não ao tópico da
  mensagem.

Soma: **~918 linhas de skill carregadas em TODO turno de TODO collaborator autenticado**, além de
`BLOCK_RULES`+`BLOCK_IDENTITY` (hardcoded, `system.js:61-165`, ~100 linhas densas) — antes mesmo de
somar a skill primária escolhida por `pickSkill`.

Para **director/coordinator/quem tem `has_coord_permissions`** (papel de liderança), soma-se ainda,
incondicional ao tópico:
- `comunicados.md` (181) + `eventos-institucionais.md` (149) + `aprovacao-comunicados.md` (93) —
  `system.js:3062-3090`, gate `hasCoordLevel(collaborator)`.
- `pedagogico.md` (120) — `system.js:2812-2817` + `2822-2824`, gate inclui `role in
  {coordinator, director}` **mesmo sem `function_role='pedagogico'`** — todo coordinator/director
  carrega a skill pedagógica inteira em toda mensagem, relevante ou não.

Para esse perfil, o total sempre-carregado sobe a **~1.461 linhas** de skill "de fundo" antes da
skill primária — em uma arquitetura cujo próprio comentário de topo diz "Total target: < 8KB"
(`system.js:2`).

---

## 5. PESO

- Maior arquivo: `skills/checklist-tarefas.md`, 710 linhas, 20 blocos de código (~exemplos de JSON e
  respostas canônicas). Estrutura (`grep "^##"`) mostra 14 subfluxos distintos: fechar/reagendar/criar
  tarefa, criar com checklist, lembrete avulso, delegar (+ cópia), pedir/decidir prazo, "active
  thread binding" anti-contaminação, snooze de lembrete, respostas canônicas, templates visíveis, e
  — nos últimos 35 linhas — um resumo de `CHECKLIST_ACTION` que duplica (de forma mais pobre) o
  conteúdo órfão de `checklists-operacionais.md` (seção 3). Boa parte do peso é regra real (vetos,
  regras de ouro, active-thread-binding), não exemplo redundante — mas a cauda de checklist
  operacional parece deslocada (deveria estar em `checklists-operacionais.md`, que já existe e está
  órfã).
- Demais top-peso: `rituais-diarios.md` (382), `criar-compromisso.md` (380, sempre carregada),
  `lista-mental.md` (337, órfã), `habitos-pessoais.md` (336), `onboarding.md` (286),
  `gerencia.md` (274), `coordenacao-conversacional.md` (273), `operacoes-tecnicas.md` (266, sempre
  para role ops), `tratamento-audio.md` (257), `checklists-operacionais.md` (252, órfã),
  `marketing.md` (225, sempre para role marketing), `broadcast.md` (224, órfã).
- Como fração do total: as 18 skills órfãs somam **2.326 das 9.395 linhas do diretório (~24,8%)** —
  praticamente um quarto do "cérebro operacional" documentado nunca é lido pelo modelo.
- `soul/`: `SKILLS-CATALOG.md` (331) é o maior — vale checar separadamente se ele lista as 18 skills
  órfãs como se estivessem ativas (não abri esse arquivo a fundo; ver seção "não coberto").

---

## O que ficou sem cobrir (honestidade sobre lacunas)

- **Não li os 6 arquivos de `soul/` linha a linha** (só usei grep pontual). Em especial não verifiquei
  se `soul/SKILLS-CATALOG.md` (331 linhas) descreve as 18 skills órfãs como funcionais — se descrever,
  é mais um doc↔código a corrigir (o catálogo mentiria sobre capacidades). Recomendo checagem dedicada.
- **Não fiz comparação campo-a-campo para TODOS os markers** — cobri em profundidade `TASK_UPDATE`,
  `EVENT_CREATE`, `EVENT_UPDATE`, `DND_SET/UPDATE`, `PREFS_UPDATE`, `CHECKPOINT_BATCH`,
  `CHECKLIST_ACTION`, `ANNOUNCEMENT_APPROVAL`. **Não cobri em profundidade**: `HABIT_ACTION`,
  `MEMORY_SAVE`, `PROJECT_CREATE/APPROVE/REJECT`, `PERSONAL_LIST_ACTION`, `SCHOOL_EVENT_ACTION`,
  `WEEKLY_PLAN`/`MONTHLY_PLAN`, `SHOP_ACTION`, `FINANCE_ACTION` (múltiplas ações),
  `COORDINATION_REQUEST/RESPONSE`, `DATA_CLASSIFY`. Dado que `INVENTORY_ACTION` já mostrou um caso
  gravíssimo (1.F) e `SHOP_ACTION`/`FINANCE_ACTION` têm handlers igualmente extensos em `engine.js`
  (linhas 7445+, 11878+), há chance real de achados semelhantes ali — não teve tempo de auditoria
  dedicado.
- **Não abri `pickSkill` por completo** — li ~1.260 das ~490 linhas da função (923-1409) mais os
  trechos de skills auxiliares (2760-2830); a cadeia de prioridades tem 20+ ramos e pode ter mais
  casos de regex conflitante que não explorei exaustivamente.
- **Não medi a taxa de rejeição real por marker** — os números de 16,7%/14,1% foram dados no brief;
  não tenho acesso a `tom_marker_log`/telemetria para confirmar quais dos achados acima são de fato
  os maiores contribuintes (são hipóteses fortes e bem fundamentadas em código, não medição).
- **Não avaliei `web/` (frontend)** além de uma checagem pontual em `quiet-hours.js`/`Configuracoes.tsx`
  para validar a divergência 1.E — não fiz varredura completa do PWA (fora do escopo desta fatia).
