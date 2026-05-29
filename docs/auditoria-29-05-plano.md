# Plano de correção — Auditoria TOM 29/05

Investigação baseada em evidência real (marker_logs + logs VPS + estado do banco).
Janela do relatório: 28/05 07:00 → 29/05 07:00 BRT.

> **Nota de contexto:** parte dos casos do relatório é de 28/05, ANTES dos fixes
> de ontem (dup-task `source='manual'` ~19:37 e retry de áudio ~01:25). Esses
> devem sumir na próxima auditoria. Marcados como [JÁ CORRIGIDO] abaixo.

---

## Categoria A — Já corrigido ontem (só validar que some)

- **dup_task "Renan"/"Leo"** (CHECK constraint `source='tom'`) → corrigido (Bug-C, source='manual').
- **Áudio Krissya não baixava** → corrigido (retry com backoff em `downloadFromUazapi`).

Ação: nenhuma. Confirmar na auditoria de 30/05.

---

## Categoria B — Bugs NOVOS confirmados

### B1. EVENT_UPDATE não suporta editar evento (`action:"update"`) — ALTA
- **Evidência:** 3 markers rejeitados (schema_invalid). Ex.:
  `{"action":"update","id":"b302611b","add_attendees":["Luciano Alf"]}`,
  `{"action":"update","event_id":"07d9e19c","notes":"..."}`,
  `{"action":"update",...,"title":"...","description":"..."}`.
- **Raiz (engine.js:2421-2426):** `VALID_EVENT_UPDATE_ACTIONS = ['reschedule','cancel','complete']`.
  Não existe `update`. Toda edição de título/descrição/notas/participantes de
  evento é rejeitada → TOM diz que fez, não persiste.
- **Fix proposto:** adicionar `action:"update"` ao `validateEventUpdateAction` +
  `applyEventUpdates`, aceitando campos editáveis: `title`, `description`, `notes`,
  `location_text`, `meeting_url`. Attendees (`add_attendees`) fica fora do MVP
  (precisa tabela de participantes) — TOM passa a colocar no `description`/`notes`.
- **Risco:** médio (toca handler de eventos). Mitigar: validar cada campo, só
  atualizar os presentes, não quebrar reschedule/cancel/complete existentes.

### B2. Dup-task agressivo demais em "Tarefa — NomePróprio" — ALTA
- **Evidência:** 5 rejeições: "Avaliação de estagiários — Renan/Leo/Kinho",
  "Criar grupo de mentoria — LA Drum". São itens legitimamente diferentes.
- **Raiz (engine.js:5287-5318):** após `stripSuffix` (remove "— XXX"), os títulos
  ficam idênticos ("Avaliação de estagiários") → jaroWinkler ~1.0 → bloqueia.
  O sufixo após "—" (que é justamente o que distingue) é descartado na comparação.
- **Fix proposto:** quando ambos os títulos têm sufixo "— ..." e os sufixos são
  DIFERENTES (nomes/grupos distintos), NÃO tratar como dup (ou rebaixar de
  `probable` → `possible`). Mantém proteção real (títulos iguais sem sufixo).
- **Risco:** baixo-médio. Mitigar: só afrouxa quando há sufixo distinto.

### B3. HABIT_ACTION schema mismatch — MÉDIA
- **Evidência:** 2 schema_invalid + 1 UNKNOWN_MARKER_STRIPPED (4 HABIT_ACTION
  concatenados). Campos emitidos: `frequency`, `reminder_time`, `habit_slug`,
  `action:"log"`. Um `{"action":"log","habit_slug":"beber-agua"}` rejeitado.
- **Raiz:** schema do HABIT_ACTION no engine não casa com o que a skill ensina
  TOM a emitir (campos e/ou múltiplos markers numa resposta). **PRECISA CONFIRMAR**
  o schema exato aceito antes de corrigir.
- **Fix proposto:** alinhar schema↔skill (aceitar array de hábitos OU múltiplos
  markers; padronizar nomes de campo). Definir após ler validação do HABIT_ACTION.
- **Risco:** baixo (feature pouco usada).

### B4. STICKER — marker inexistente que TOM inventa — BAIXA
- **Evidência:** 2x `<<STICKER>>tom_dancando<<END>>` / `tom_ufa_conseguimos` →
  stripados (não quebra, mas TOM "promete" mandar sticker e não manda).
- **Raiz:** SOUL/prompt sugere capacidade de sticker que não existe no engine.
- **Fix proposto (escolher):** (a) remover menção a stickers do prompt [simples,
  recomendado], ou (b) implementar marker STICKER de verdade via UAZAPI.
- **Risco:** baixíssimo (opção a = só prompt).

### B5. COORDINATION_REQUEST: destinatário não encontrado (Diana) — MÉDIA
- **Evidência:** "avisa a Diana do recreio" → `Diana:recipient_not_found` +
  1 schema_invalid.
- **Raiz:** "Diana" não cadastrada em collaborators OU fuzzy de nome falhou.
- **Fix proposto:** quando recipient não encontrado, TOM responder pedindo
  confirmação do nome ("não achei a Diana no sistema, confirma o nome completo?")
  em vez de falhar silencioso. Verificar se Diana deveria estar cadastrada.
- **Risco:** baixo.

---

## Categoria C — Métrica inflada (detector sensível demais)

### C1. ACTIONABLE_NO_MARKER com muitos falsos positivos — MÉDIA
- **Evidência:** dos 21, vários NÃO são ação pendente:
  - "Estou verificando isso sim" (Arthur — só confirmando)
  - "vou reformular, primeiro ponto..." (planejando em voz alta)
  - "E o evento que criei no app?" (pergunta do user)
  - "pausa estratégica disso por uns dias" (informando, não pedindo)
- **Raiz:** o detector marca como "ação verbalizada sem persistir" respostas que
  são confirmação/pergunta/planejamento.
- **Fix proposto:** refinar heurística do detector (health-check / engine) pra
  excluir confirmações curtas, perguntas e fala de planejamento.
- **Risco:** baixo (afeta só métrica de auditoria, não comportamento do TOM).
- **Obs:** parte dos 21 são reais (inventário Rodrigo, já endereçado em sprint
  anterior; e os casos B1/B2).

---

## Categoria D — Operacional / infra

### D1. 17/26 tasks vencidas sem cobrança — ALTA
- **Evidência (banco):** 26 vencidas abertas, **0 com pending_followup**, 8 colabs.
- **Raiz:** `pending_followups` (Sprint 31.1) cobre EVENTOS e alertas específicos,
  mas **não há job que crie followup/cobrança pra tasks vencidas comuns**. As
  tasks vencem e ninguém é cobrado proativamente.
- **Fix proposto:** novo job no dispatcher (1x/dia, manhã) que varre tasks
  `status not in (done,cancelled) AND due_date < hoje`, manda cobrança ao
  assigned_to e registra `pending_followups` (kind=`overdue_task`). Reusa a infra
  que já existe pra eventos.
- **Risco:** médio (novo job que dispara WhatsApp). Mitigar: limite por pessoa/dia,
  dedupe via pending_followups, começar só com os donos certos.

### D2. Realtime "Erro de canal: undefined" (8x/24h) — BAIXA
- **Evidência:** erro recorrente a cada 2-3h; subscriber se reconecta sozinho.
- **Raiz:** handler de erro do realtime subscriber loga `undefined` (não captura
  o status real do canal) e provavelmente reassina.
- **Fix proposto:** melhorar log (status real) + backoff de reconexão explícito.
- **Risco:** baixo.

### D3. Admin sem conversa 7+ dias — NENHUMA
- Conta de sistema. Fix: excluir Admin/contas de sistema da métrica.

---

## Categoria E — As 3 "promessas sem persistência"

1. **Quintela 20:03** → dup-task (B2 + Bug-C já corrigido). Resolver B2 fecha de vez.
2. **Krissya 19:15** → "Reagendado pra 31/05" mas TASK_UPDATE reschedule `all_failed:1`.
   - Item "Lembrar Kailane..." é TASK (id e15eeff8), assignada a OUTRA pessoa
     (Arthur/Kailane), não à Krissya. Reschedule por título escopado ao remetente
     não acha → falha.
   - **Fix proposto:** permitir reschedule cross-user quando o item foi
     explicitamente referenciado numa cobrança/notificação (relação já existe via
     coordination/notify). Risco médio. **Precisa investigar o lookup do reschedule.**
3. **Arthur 17:55** → "Estou verificando isso sim" = falso positivo (C1). Sem ação.

---

## Ordem de execução sugerida (incremental, sem quebrar nada)

| # | Item | Prioridade | Risco | Esforço | Status |
|---|------|-----------|-------|---------|--------|
| 1 | B1 EVENT_UPDATE `update` | Alta | Médio | M | ✅ FEITO (engine+skill, deploy, 7/7 testes) |
| 2 | B2 dup-task sufixo distinto | Alta | Baixo-Médio | P | ✅ FEITO (engine, deploy, 6/6 testes) |
| 3 | D1 cobrança de tasks vencidas | Alta | Médio | M | ✅ FEITO (era artefato de medição — corrigido no health-check) |

### Revisão do D1 após investigação
O job de cobrança (`checkOverdueAlerts`) **funciona** — 20 alertas/24h enviados.
O "17/26 sem cobrança" era **artefato da auditoria**: (a) rodava 07:00, antes do
job de cobrança (~08:13); (b) contava TODAS as vencidas, mas o chaser só cobre
1-5 dias por design (6+ dias → CEO report). Fix: health-check agora mede só a
janela 1-5d com lookback de 48h. Resultado simulado: 0 sem cobrança.
| 4 | B5 coordination recipient claro | Média | Baixo | P | ✅ FEITO (superficia falha de 1 destinatário + msg acionável) |
| 5 | C1 refinar ACTIONABLE detector | Média | Baixo | P | ✅ FEITO (exclui pergunta/auto-relato, 8/8 testes) |
| 6 | E2 reschedule cross-user | Média | Médio | M | ✅ FEITO (delegador remarca + avisa executor; msg clara p/ não-dono) |
| 7 | B3 HABIT_ACTION schema | Média | Baixo | P | ✅ FEITO (normaliza title→name, habit_slug→habit_name) |
| 8 | B4 STICKER | Baixa | Baixíssimo | P | ✅ FEITO (já funcionava via sendMedia; só silenciei ruído UNKNOWN_MARKER) |
| 9 | D2 realtime log/reconexão | Baixa | Baixo | P | ⏳ pendente |
| 10 | D3 excluir Admin da métrica | Baixa | Nenhum | P | ✅ FEITO (ignora contas de sistema) |

### Revisão do B4 após investigação
A implementação de figurinhas **já existia e funciona** (parser `_pendingStickers`
+ envio via `sendMedia type:'sticker'`). Testei ao vivo: a UAZAPI aceitou e enviou
o `tom_pensando` pro Alf. O único problema era **ruído de log**: o parser extraía o
nome mas não removia o marker do texto, então o catch-all stripper o logava como
`UNKNOWN_MARKER_STRIPPED` (inflando "markers rejeitados" na auditoria). Fix: o parser
agora remove o marker (igual o REACT faz). Quase dupliquei a feature — reverti.

Cada item = 1 fix isolado + validação (smoke/teste) + deploy. Nada em lote.
