# Reunião de Grupo de Verdade — Design

**Data:** 2026-07-01 · **Status:** aprovado (design) → writing-plans
**Origem:** regressão real (Alf 01/07). TOM cria reunião de grupo como N eventos separados (1 por pessoa via `to_name`) + coloca o criador como participante de todos → 9 cards duplicados na agenda do criador, briga com o anti-duplicata, RSVP perdido, e o fluxo estruturado (modalidade/local/participantes) some porque a skill **não tem caminho de grupo** — o LLM improvisa e larga tudo.

## Objetivo

TOM cria reunião com N pessoas do jeito CERTO — **1 evento + N participantes** (o mesmo modelo que o PWA já usa manual) —, com o fluxo estruturado de volta (pergunta modalidade/local, confirma a lista), RSVP que volta pro organizador com placar, e o picker do PWA mostrando os participantes já selecionados. Zero-regressão no 1:1 e no evento pessoal.

## Problema (medido 01/07)

- Broadcast pros 8 → `EVENT_CREATE ok=1 fail=8 (held_dup)`: só o evento do criador nascia; os 8 destinatários batiam nele (mesmo título+data, dedup do criador) e eram bloqueados.
- Correção de dedup (evento dirigido pula o dedup do criador) fez os 9 nascerem — mas expôs a raiz real: **N eventos é o modelo errado**. O criador vira participante dos 8 → 9 cards.
- `event_participants` já é usado por 46 eventos `source=manual` (PWA) e 3 `source=tom` (últ. 25/05) — o modelo 1-evento-N-participantes existe e é o certo; TOM é que não o usa pra grupo.
- Skill `criar-compromisso.md` tem o fluxo bonito (linhas 8-21: pergunta modalidade/categoria/local; "NUNCA assuma presencial/la_music") MAS só cobre `to_name` singular (linha 223). Sem caminho de grupo, o LLM improvisa e perde a estrutura.

## Arquitetura

```
"reunião sexta 9h com Anne, Quintela, +6"
  → skill: pergunta modalidade/local + confirma a lista (se faltar)
  → <<EVENT_CREATE>> { ...evento, attendees: ["Anne","Quintela",...] }
  → engine: resolve nomes→collaborator_ids; cria 1 evento (dono=criador);
            insere N event_participants (status='invited'); avisa cada um
  → convidado responde "vou" → RSVP: event_participants.status='confirmed'
            + notifica o organizador ("✅ Quintela confirmou · 3/8")
  → lembrete do evento dispara pro organizador E pros participantes confirmados
```

## Componentes

### 1. Marker — `attendees` no `EVENT_CREATE`
- Novo campo opcional `attendees: string[]` (nomes). Presente → é reunião de grupo (1 evento + participantes). Ausente → caminho de hoje (evento simples ou `to_name` 1:1).
- `to_name` (1:1) permanece intacto e distinto: `to_name` = evento na agenda do OUTRO (dono é o outro); `attendees` = evento na agenda do CRIADOR com os outros como participantes. Um pedido "marca reunião com A, B, C" → `attendees`. Um "coloca na agenda do Jereh" → `to_name`.

### 2. Engine — handler de grupo (novo ramo em `applyEventActions`)
- Quando `attendees` presente e length ≥ 1:
  1. Resolve cada nome → colaborador ativo (reusa o resolvedor de `to_name`; `resolveCollaboratorByName`). Nome sem match → coletar em `unresolved`, não abortar os demais.
  2. Cria **1** evento com `collaborator_id = criador` (dono). Dedup do criador roda normal (é a agenda dele; 1 evento só, sem colisão).
  3. Pra cada colaborador resolvido: insere `event_participants` (`status='invited'`, `invited_by=criador`, `invited_at=now`). Dedup por (event_id, collaborator_id) — não duplica se reprocessar.
  4. Notifica cada participante (mesma msg "📅 *Criador* marcou um compromisso... confirma?" que já existe).
- Retorna `{ okCount, participantsAdded, unresolved }` pro engine reportar honesto ("criei a reunião e convidei 6; não achei 'Fulano' e 'Ciclano'").

### 3. Skill — seção "Reunião de grupo"
- Gatilho: 2+ pessoas nomeadas numa criação de compromisso.
- Regra: **mesmo fluxo de hoje** — se faltar modalidade/categoria/local, PERGUNTA num bloco só (a estrutura que já existe, linhas 8-21) E confirma a lista de convidados: *"Reunião sexta 9h, presencial, na LA — com Anne, Quintela, +6. Confirmo e aviso todo mundo?"*. Só então emite `EVENT_CREATE` com `attendees`.
- Anti-confab: só diz "convidei os 8" se emitiu os 8 em `attendees` (a rede `SEND-CLAIM-NOMARKER` já cobre o vazio).

### 4. RSVP → organizador (fecha o buraco do "não recebi nada")
- O RSVP já resolve o convite pendente do colaborador e grava `status` (existe). Falta: **após gravar, notificar o organizador** (`invited_by`/dono do evento) com "✅ *Quintela* confirmou presença na *Reunião Time Gestão* · 3/8" (ou "❌ ... não vai · —").
- Placar = count de `event_participants` do evento por status. Determinístico.

### 5. PWA — picker pré-selecionado + card com placar
- `EditEventSheet`/`ParticipantsPicker`: ao abrir um evento, **carregar os `event_participants` existentes e pré-marcar** (hoje mostra "Sem convidados." mesmo com participantes — bug que o Alf apontou).
- Card do evento: lista os convidados + placar de confirmação (X/N confirmados).

### 6. Lembretes — organizador + participantes confirmados
- Hoje o lembrete (`event_reminders` → dispatcher) notifica só o dono (`collaborator_id` do evento). Estender: ao disparar, notificar o dono **e** cada `event_participants.status='confirmed'`. (Aprovado pelo Alf: "participante confirmado recebe lembrete também".)

## Fluxo de erro
- Nome sem match → não aborta; cria o evento + convida os resolvidos + reporta honesto quem faltou. NUNCA diz "convidei todos" se faltou alguém (rede anti-confab).
- Zero attendees resolvidos → cria o evento só do criador + avisa "não consegui identificar os convidados — me confirma os nomes".
- Gates de alçada (Farmer→director etc., linha 235 da skill) valem por participante.

## Zero-regressão (o miolo)
- `to_name` 1:1 e evento pessoal/simples: **caminho de hoje, byte a byte** (o ramo novo só ativa com `attendees`).
- Dedup do criador segue rodando pro evento único (1 evento, sem colisão).
- Golden: `EVENT_CREATE` sem `attendees` == comportamento atual.

## Testes
- Resolução de nomes → collaborator_ids (com unresolved parcial). Puro.
- Placar de RSVP (count por status). Puro.
- Engine: 1 `attendees[6]` → 1 evento + 6 participants + 6 convites; 0 held_dup.
- Skill: 2+ pessoas sem modalidade → pergunta (não cria). Live/replay.
- RSVP → notifica organizador com placar correto.
- PWA: abrir evento com participantes → picker pré-marcado.

## Faseamento (cada fase testável, deploy gated)
- **F1 — núcleo do motor:** resolver-nomes (puro) + ramo `attendees` em `applyEventActions` (1 evento + participantes + convites) + reporte honesto. Golden zero-regressão.
- **F2 — skill de grupo:** seção "reunião de grupo" (pergunta modalidade/local + confirma lista + emite `attendees`).
- **F3 — RSVP→organizador:** notifica o dono ao confirmar/recusar + placar.
- **F4 — lembrete pra participantes confirmados** (dispatcher).
- **F5 — PWA:** picker pré-selecionado + card com convidados/placar.

## Fora de escopo (YAGNI)
- Editar participantes DEPOIS via TOM (add/remove por chat) — F futura; por ora edita no PWA.
- Reagendar propaga aviso a todos — considerar em F futura (o evento é 1 só agora, então reagendar já é simples; o aviso-em-massa é o extra).
- Sub-grupos/papéis, calendário externo (Google), .ics.
