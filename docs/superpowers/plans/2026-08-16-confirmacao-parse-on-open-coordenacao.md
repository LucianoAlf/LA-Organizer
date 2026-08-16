# Confirmação parse-on-open (coordenação) — Plano

> Executar com TDD, catraca, zero-regressão. Baseline da suíte VPS = fail 3.

**Goal:** confirmação de coordenação em prosa passa a resolver determinística — o "sim" despacha
o recado sem depender do LLM re-emitir marker.

**Arquitetura:** módulo puro extrai `{recipient_name, message_body}` da fala do TOM; o hook
genérico de fim-de-turno popula `payload.coordination.items`; o executor existente (@engine 10221)
despacha no "sim". Fail-closed: sem extração fiel → payload só-texto de hoje.

## Global Constraints
- Fail-closed: só estagia com destinatário E texto explícito extraíveis.
- Parse SÓ na fala do TOM (reply), nunca no texto do usuário.
- Zero-regressão por construção (sem extração → payload inalterado).
- `.deploy-hold` na raiz e `_remote/` antes de editar `src/`; md5 antes do restart; replay antes do aceite.

---

### Task 1: módulo puro `coord-question-parse.js`

**Files:** Create `src/coordination/coord-question-parse.js`; Test `src/coordination/coord-question-parse.test.js`

**Interfaces — Produces:** `parseCoordinationConfirmQuestion(replyText) → { recipient_name, message_body } | null`

- Extrai destinatário: nome após `Aviso o/a/os/as …` (1–2 tokens), com guard de negação (`não aviso` → null).
- Extrai mensagem: SÓ quando explicitamente delimitada — após `Segue o texto:` e/ou entre aspas
  `"…"` / `> "…"`. Strip de markdown (`*`), `> `, espaços. Sem delimitador → null.
- Retorna objeto só quando recipient E message ambos presentes e não-vazios; senão null.

- [ ] Step 1: testes (casos reais):
  - Yuri c/ "Segue o texto: > \"Oi Yuri, …?\"" → `{recipient_name:'Yuri', message_body:'Oi Yuri, …?'}`
  - "Aviso a Krissya amanhã às 18h40 pra pegar os fones em CG? Confirma?" (implícito) → null
  - "Aviso o Alf sobre os calendários? Confirma?" (implícito) → null
  - não-coordenação ("Confirma o fechamento destas 2 tarefas?") → null
  - negação ("Não aviso ninguém agora.") → null
  - vazio/nulo → null
- [ ] Step 2: rodar, ver falhar. Step 3: implementar. Step 4: verde.

### Task 2: fiação no engine (hook genérico)

**Files:** Modify `src/engine.js` (~13432, bloco `detectConfirmationQuestion`)

**Interfaces — Consumes:** `parseCoordinationConfirmQuestion` (Task 1); executor `coordination.items` (10221, existente)

- Import do módulo no topo.
- No bloco onde monta `payload = {last_user_text, last_tom_reply}`: se
  `parseCoordinationConfirmQuestion(reply)` retorna item, `payload.coordination = { items: [{ recipient_name, message_body, mode:'relay_assisted' }] }`.
- `node --check`. Sem teste unitário de engine (VPS/replay cobre).

### Task 3: replays

**Files:** Create `scripts/replay-lab-cenario-confirma-recado.js` (verde), `scripts/replay-lab-cenario-confirma-recado-implicito.js` (vermelho/fail-closed)

- VERDE: injeta reply do TOM "Aviso o [QA]? Segue o texto: '…'. Confirma?" como intent aberto
  (ou fluxo real) → usuário "Confirma" → assert: `coordination_requests` row criada (ou executor
  disparou) e SEM "perdi o fio / não consegui".
- VERMELHO: pergunta de coordenação SEM texto explícito → "Confirma" → assert: NÃO criou recado
  (fail-closed; caiu no caminho honesto).

### Task 4: deploy ritual

- Registrar commit prod + pm2 antes; commit+push; VPS reset; md5 local×VPS; suíte VPS fail 3;
  replays verde+vermelho; `pm2 restart`; provar restart (`ps -o lstart=`); remover holds; KI INSERT.
