# Plano de correção raiz — família "resposta curta cai na pendência errada"

> **STATUS FINAL (10/06 00h): PLANO 100% ENTREGUE.** F0 ✅ · F1 ✅ · F2 ✅ · F3 ✅ (inbox único no prompt com
> idade + flag FRESCA/ANTIGA, rollback INBOX_BLOCK=off) · F4 ✅ (resolveApproverFor pela matriz — prova VPS
> Rafinha→Luciano Alf; execução escopada + anti-self + anti-corrida) · F5 ✅ (isFutureCompletion bloqueia
> complete de item futuro + intent ANCORADA + auto-resolve ancorado sem LLM + detectUserConfirmation ≤4
> palavras) · F6 ✅ (FRESH_WINDOW_MIN único; marker_emitted honesto; confirmação de leitura usa texto
> original; ✓ do PWA notifica criador via realtime watcher; skills alinhadas). 112/112 testes; known issues
> APROVACAO-SEM-FUNIL, GOV-APROVADOR-DIVERGENTE e ALVO-FUTURO-RESPOSTA-CURTA = corrigido.

> Origem: auditoria multi-agente 09/06/2026 (18 agentes, verificação adversarial 2 lentes/causa).
> Incidentes-gatilho: A) "Aprovado" do Alf completou evento errado (projeto Rafinha seguiu pendente);
> B) "Aprovar" não achou o comunicado 0f5a; C) "Reunião ok tbm" da Ana fechou a Reunião ADM de AMANHÃ.
> Known issues: APROVACAO-SEM-FUNIL, GOV-APROVADOR-DIVERGENTE, ALVO-FUTURO-RESPOSTA-CURTA (status=aberto).

## Síntese do problema

Os 3 incidentes têm a MESMA anatomia: (1) o sistema cria uma pendência mas **não a registra como
estado consultável** (card de aprovação fire-and-forget, sem `pending_intent`, sem `conversation_history`,
sem bloco no prompt); (2) a resposta curta natural ("Aprovado", "Aprovar", "Reunião ok tbm") **não casa
nenhum detector determinístico** (gate da skill `/^(APROVA|REJEITA)\b/` + `/^(aprov[oa]|rejeit[oa])$/`
falha nas formas reais — mesma família do ALIGN-AMANHA); (3) o LLM, único árbitro, casa a resposta com
**o que estiver visível** — e o visível era a intent stale exibida por 24h com a ordem "feche o loop —
não repergunte", anulando a guarda de 20min do engine (assimetria engine×prompt).

Correção raiz = dar ESTADO às pendências, dar DONO determinístico ao vocabulário de aprovação, e fazer
engine e LLM enxergarem o MESMO inbox com a MESMA política de frescor.

## Decisão arquitetural

**SIM ao inbox unificado — como extensão do `pending_intents` + camada de LEITURA composta
(`buildPendingInbox`). NÃO criar tabela nova, NÃO migrar convites/followups de storage** (funis sãos;
RSVP acabou de ser estabilizado — caso Fefê prova). O que falta não é storage único, é **visão única**.

Princípio: **a decisão de ALVO é determinística; o LLM continua no caso genuinamente ambíguo — mas
sempre vendo o mesmo inbox que o engine, com a mesma política de staleness.**

---

## Fase 0 — Reparos de dados + protocolo (FEITO em 09/06, exceto item 1)
1. Projeto `00d9d671` (Programa de Manutenção, Rafinha): **aguarda confirmação do Alf** → aprovar
   espelhando `applyProjectApprove` (status='planning', requires_approval=false, approved_by=Alf,
   approved_at=now) + notificar Rafinha.
2. ✅ Tasks "Reunião ADM" de amanhã (`d3073fe9`, `566cdf39`) revertidas done→pending. (Dedup pendente —
   são a mesma reunião 2×.)
3. Task bombinha `18e37868` (due 10/06, fechada 09/06): ambígua — confirmar com Ana antes de mexer.
4. ✅ 3 registros em `tom_known_issues` (status=aberto; viram corrigido por fase).

## Fase 1 — Aprovação vira ESTADO (raiz de A e B)
- **Novo** `src/services/approvals.js` (supabase injetado): `openProjectApproval`,
  `openAnnouncementApproval`, `listOpenApprovals`, `resolveApproval`. Payload
  `{domain:'project'|'announcement', ref_id, token?, short_id?, requested_of}`.
- `pending-intents.js`: supersede de `approval_pending` só por mesmo `ref_id`; expiry 7 dias (não 24h).
- `internal-api.js:456-467` e `engine.js:1083-1096`: após enviar o card, abrir a intent no APROVADOR +
  `logConversation` outbound do card (conserta enrichment de reply-quote). **Voltar o ID de 4 chars no
  card de comunicado** (shortId já computado em engine.js:1063 e descartado).
- `applyProjectApprove/Reject` + `applyAnnouncementApproval`: resolver a intent ao executar.
- Lembrete 6h (`dispatcher.js remindPendingProjectApprovals`): re-toca `asked_at` (re-fresca a janela).
- Testes: `approvals.test.js` (mock injetado). Risco baixo (só adiciona estado).

## Fase 2 — Intercept determinístico de aprovação (pré-LLM)
- **Novo** `src/events/detect-approval-reply.js` (puro, espelha detect-rsvp-reply):
  `detectApprovalReply(text) → {decision:'approve'|'reject', token, reason, bare} | null`.
  Casa `APROVA <TOKEN>`/`REJEITA <TOKEN> [motivo]` (sem âncora rígida) + bare: aprovado, aprovo,
  aprova, aprovar, pode aprovar, ta aprovado, rejeitado, rejeito, nao aprovo (≤4 palavras).
  "sim/ok" NÃO entram (continuam do RSVP/intents).
- `webhook.js:262-298`: preservar `rawText` e `quotedText` como campos separados — gates
  determinísticos usam rawText (reply-quote não derrota mais regex ancorada).
- Intercept no engine (entre RSVP-bare ~7195 e auto-resolve ~7281):
  token → resolve escopado às intents do respondente (fallback global compat);
  bare + 1 aberta → executa; bare + 2+ → lista numerada com comandos (aceita "1/2" no turno seguinte);
  bare + 0 → NÃO consome; injeta ctxHint negativo ("NÃO trate como confirmação de outra pendência").
- `system.js:1078`: gate de fallback vira `/^\s*(aprov|rejeit)/i` sobre rawText.
- **ANTI-FIX: NÃO adicionar "aprovado" ao YES_RE** do detectUserConfirmation.
- Testes: tabela com as 6 formas reais + negativos. Risco médio (caminho quente; guarda hasCoordLevel).

## Fase 3 — Inbox unificado no prompt + staleness
- **Novo** `src/services/pending-inbox.js`: `buildPendingInbox(supabase, collaborator)` compõe
  approvals + intents + convite pendente + followups, com `fresh` (≤20min) e prioridade.
- `system.js:2667-2710`: bloco único; item fresco mantém "feche o loop"; item stale ganha
  "⏳ há Xh — NÃO assuma que resposta curta se refere a isto; confirme antes de agir".
- Engine consome o MESMO inbox (elimina dupla leitura). Skills corrigidas: aprovar-projeto.md:52,
  aprovacao-comunicados.md (linha 93 contraditória + ":15 todos os directors"), comunicados.md:144-6
  (separar AUDIENCE de APROVADOR). Rollback: env `INBOX_BLOCK=off`. Risco baixo-médio.

## Fase 4 — Governança: aprovador = resolveLeadersOf(criador)
- Em `approvals.js`: `resolveApproverFor(creator, allCollabsWithEdges)` =
  `resolveLeadersOf(...)` filtrado por phone; [0] = primário. Rafinha→Alf **por regra** (fallback CEO),
  não por sorte do supervisor_id legado (que se fosse NULL mandaria pro "Admin" alfabético!).
- Substituir cascata em `internal-api.js:412-454` E cobrança `dispatcher.js:3079-3107` (hoje divergem);
  comunicado sai do hardcode is_ceo (engine.js:1048-1055) para o mesmo resolver.
- `supervisor_id` deixa de ser lido nos 3 pontos (consistente com a matriz 08/06).
- Execução escopada: `applyProjectApprove` exige intent aberta do respondente OU ∈ resolveApproverFor +
  **anti-auto-aprovação** (`created_by !== collab.id` — Rafinha tem has_coord_permissions e hoje pode
  aprovar o próprio projeto!); `applyAnnouncementApproval` 'latest' → só entre os notificados;
  UPDATE com `.eq('status','pending_approval')` (anti dupla-aprovação).
- Log `[Approval] approver resolved: X for creator Y (rule=...)` por 1 semana. Risco médio.

## Fase 5 — Incidente C: âncora + guarda temporal
- Ritual de fechamento abre intent com `payload.anchor={type:'event',id,title}` → auto-resolve YES
  fresco aplica complete direto no id ancorado (sem LLM); respondente participante≠dono → fecha o
  followup dele + notifica o dono (substitui a promessa órfã engine.js:8210).
- **Novo** `src/utils/complete-guards.js`: `isFutureCompletion({dueDate,startAt,now,tz})` —
  complete com data ≥ amanhã (BRT) → NÃO grava; pergunta "está marcado pra DD/MM — confirma que já foi?"
- `detectUserConfirmation` endurecido: só bare ≤4 palavras ("Não foi a ADM foi a de governança" → LLM).
- Testes timezone BRT (date-only vs timestamp). Risco médio (menos recall do auto-resolve, compensado
  pelo inbox da F3).

## Fase 6 — Higiene
- `FRESH_WINDOW_MIN=20` única em utils/dates.js + mapa-comentário da ordem dos intercepts.
- Colisão ctxHint × confirmação de leitura de comunicado: avaliar rawText pré-hint.
- `_metrics.marker_emitted` verdadeiro (conserta noMarkerEmitted mentiroso que supersedeu a intent
  legítima no Incidente A). Guarda RSVP-bare: intent fresca só se sem âncora de outro domínio.

## O que NÃO fazer
1. "aprovado" no YES_RE. 2. Tabela nova de inbox / migrar convites. 3. Consertar só a regex da skill
(sem estado o bug volta por outra fresta). 4. Logar 'error' sob o tipo do claim em pre-gates (lição
alreadySent). 5. Cada fase: node --check + node --test + scp + pm2 restart + replay do incidente nos
logs antes de marcar corrigido.
