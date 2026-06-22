# Criação de tarefa robusta — "fala = persistência" garantida

**Data:** 2026-06-22
**Autores:** Alf + Claude (Opus 4.8)
**Status:** Design aprovado; aguardando revisão da spec antes do plano
**Família:** [[AUDIT-OPTIMISTIC-CONFIRM]], [[FIN-FAKE-CONFIRM]], [[BATCH-COMPLETE-CONFIRM-NOOP]] (mesma doença: o LLM narra a ação sem emitir o marker)

---

## 1. Problema

**Caso Dai (21/06, 14:16–14:18 BRT).** Ela planejou a semana por áudio (3 tarefas de canto). O TOM resumiu, perguntou *"Tá certo?"*, a Dai **confirmou** ("Isso mesmo"), o TOM respondeu *"Semana organizada, te cobro conforme for chegando"* — e **nenhuma tarefa foi criada**. Provider = **Claude no ar** (não é fallback). 

Não é isolado: `ACTIONABLE_NO_MARKER` (14 dias) mostra **Rose 33**, Rodrigo 12, Ana Paula 6, +13 pessoas — e essa lista **subconta**, porque o turno "organizada" da Dai veio `actionable_intent=false` e nem foi flagrado.

**A correção do usuário (decisiva):** educar a equipe a confirmar NÃO resolve — a Dai confirmou e ainda assim falhou. O conserto tem que ser de código.

## 2. Causa-raiz (duas camadas)

- **Camada UX:** o TOM confirma **antes** de criar ("Tá certo?"). Para tarefa (barata, reversível) isso é fricção + ponto de falha sem proteger nada.
- **Camada engine (a regressão):** quando o TOM pergunta sem emitir marker, o engine abre um intent genérico **só-texto** `{last_user_text, last_tom_reply}` (`engine.js:11001`), desenhado para "o LLM ler e emitir o marker no próximo turno". MAS o gate `hasConcrete` (`engine.js:8520`, do **RECUR-TEMPLATE-DUP** 10/06) vê o payload sem `draft/drafts/ids` → injeta *"NÃO emita marker; NÃO toque em tasks"*. **O engine PROÍBE a criação mesmo depois da confirmação.** Colisão entre dois fixes — regressão silenciosa desde 10/06 para todo fluxo "propõe → 'tá certo?' → 'sim'".
- **Doença de fundo:** o LLM narra a ação sem emitir o marker estruturado. Não dá para impedir via prompt — só via **rede determinística**.

## 3. Objetivo / Não-objetivo

**Objetivo:**
1. A tarefa nasce no momento em que a pessoa enuncia um plano claro.
2. **Garantia determinística:** "o TOM disse que criou" ⟺ "a tarefa existe". Nunca um "criei" silencioso falso.

**Não-objetivo / fronteiras (sagradas):**
- ❌ Não mexer em recorrência / `materializeAll` / Balde A (sob observação).
- ❌ Não alterar o gate `hasConcrete` (proteção do RECUR-TEMPLATE-DUP) — o create-first **desvia** dele, não o toca.
- ❌ Não mudar tom/voz/tamanho das respostas (voz é sagrada). O TOM continua confirmando — só **depois** de criar.
- ❌ Não tocar no confirmar-**antes** de ações irreversíveis (recado, apagar, dinheiro, concluir tarefa de data futura). Confirm-antes continua certo lá.

## 4. Design

### Parte 1 — UX: criar-na-hora, confirmar-depois
Para enunciado claro de tarefa(s) — inclusive planejamento por áudio — o TOM **emite os markers de criação imediatamente** e confirma na **mesma** mensagem:
> "✅ Anotei pra você: terça *Campo Grande*, quinta *Recreio*. Me corrige se algo estiver errado. 👊"

Sem portão "tá certo?" antes. Campo opcional ausente (ex.: motivo da ida à Barra): **cria com o que tem e pergunta depois** — nunca segura a criação por campo opcional. É mudança de **sequência** (age → confirma), não de tom. Local: guidance de skill (arquivo exato no plano — provável skill de tarefas/planejamento + `soul/AGENTS.md`).

### Parte 2 — A GARANTIA: rede determinística "fala = persistência"
Defense-in-depth, **100% aditiva**, dispara só no caso de falha (afirmou criação **e** nenhum marker rodou no turno):

1. **Detector mais esperto.** O radar de "ação sem marker" (`engine.js ~10798–10846`) hoje não reconhece linguagem de criação/organização ("anotei", "criei", "deixei marcado", "agendei", "organizada", "te cobro"). Ampliar o reconhecimento para essas formas. O gate "só dispara se NENHUM marker rodou" protege a criação legítima de virar falso-positivo (não reabre o C1).
2. **Auto-retry força o marker.** Quando (afirmou ∧ sem marker), aciona a máquina de auto-retry que **já existe** (Sprint 28.2 — chamada dedicada que persiste o marker), agora cobrindo as formas ampliadas. A tarefa nasce de verdade.
3. **Se ainda assim não nascer → honestidade.** Reescreve a resposta para honesta ("não consegui registrar agora — me manda de novo?"), espelhando `sanitizeOptimisticConfirm`. NUNCA deixa sair "criei" sem lastro.

**Resultado garantido:** ou a tarefa nasce (retry), ou o TOM fala a verdade. Fim do "criei" silencioso — para Dai, Rose, todo mundo.

## 5. Componentes afetados
- `src/engine.js`: detector `actionable_intent` (~10798–10846) — ampliar reconhecimento; auto-retry (~10848+) — cobrir formas ampliadas; honest-rewrite no caminho sem-marker.
- Helper puro novo (testabilidade): `src/utils/creation-claim.js` — `looksLikeCreationClaim(text)`, isolado e testável.
- `skills/*.md` (tarefas/planejamento) + `soul/AGENTS.md`: guidance create-first (Parte 1).
- **Não toca:** `hasConcrete` (8520), registrador genérico (11001), `batch-complete`, recorrência.

## 6. Testes (TDD — vermelho → verde)
- **Unit** (`creation-claim`): "semana organizada / te cobro" → claim=true; "ok, fechado" / pergunta pura → false; reply de criação legítima (com marker no turno) → não reflaga.
- **Repro do caso Dai:** reply "Semana organizada... te cobro" + 0 markers → a rede dispara (retry; sem persistência → honesto). Garante que **nunca** passa "criei" silencioso.
- **Suíte inteira** (1065) verde; nenhum FP novo no ACTIONABLE.

## 7. Não-regressão (o medo do Alf: "arrumar um, quebrar outro")
- **Aditivo:** só atua no caso de falha; criação que já funciona (marker rodou) é intocada.
- `hasConcrete` / RECUR-TEMPLATE-DUP **não tocados** (create-first desvia).
- **Padrão já provado em produção:** FIN-FAKE-CONFIRM (finanças) faz exatamente isto e subiu limpo.
- `node --check` + suíte + scp + `pm2 restart` + canário antes de declarar pronto.

## 8. Ledger
Ao fim, registrar KI `PLANNING-CONFIRM-NO-CREATE` (raiz: narrate-without-persist na criação; regressão `hasConcrete` × registrador genérico; fix: create-first + rede determinística), vinculado aos irmãos da família.
