# Síntese — Auditoria TOM 02/06 (foco: erros recorrentes diários)

## Reenquadramento: a maior parte do "alarme diário" é RUÍDO DE MÉTRICA, não 21 bugs

Investiguei cada flag com dado. O que se repete todo dia é, em grande parte, a
**auditoria medindo errado** — não 21 falhas reais. Separando:

### 1. "21/41 sem cobrança" → FALSO ALARME (timing do health-check)
- Dado agora: **30/32 tasks cobradas em 48h**, último alerta **hoje 11:13**. Cobrança saudável.
- Causa do número alto: o health-check roda **07:00**, ANTES do job de cobrança do dia (8–19h).
  Tasks que viraram overdue de madrugada ainda não foram cobradas às 07:00 → contam como
  "sem cobrança", e às 11:13 já foram cobradas. Gap real ≈ 2 (quiet/cooldown).
- **Fix definitivo (métrica):** no CHECK 4, não contar como "sem cobrança" task que ainda
  não passou por uma janela de cobrança (ex: virou overdue hoje e ainda é antes do 1º tick
  do dia). Alinhar a medição à política real (já é quiet-aware; falta ser timing-aware).

### 2. "26 markers rejeitados" = ~23 ACTIONABLE_NO_MARKER + 2 COORD + 1 HABIT
- #2 e #3 são a **mesma pilha**. Breakdown real de schema é minúsculo (2 COORD, 1 HABIT).

### 3. "21 ACTIONABLE_NO_MARKER" → ~80% RUÍDO
A métrica dispara em casos que NÃO são falha:
- **Acknowledgments:** "Tudo ok" (2×) — não é ação pro TOM.
- **Turnos intermediários de fluxo multi-step:** inserção de inventário por FOTO (Alf mandou
  vários Strinberg/Condor), com "qual sala?", "[O usuário está RESPONDENDO...]", análise de
  imagem — o marker vem em OUTRO turno; os intermediários corretamente não têm marker.
- **Confirmações de pending_intent** ("Sim/Ok/Isso" + [CONTEXTO INTERNO]).
- **Fix definitivo (métrica/detector):** excluir acknowledgments e turnos de fluxo
  multi-step/confirmação da contagem ACTIONABLE_NO_MARKER (precisão, não silenciar).

### 4. Misses REAIS atrás do ruído (poucos, alto valor)
- **Lembrete largado quando falta um detalhe:** Anne pediu "me lembra amanhã de manhã de
  pagar" / "estudar pra simulado quarta" → TOM perguntou "o que/que horas?" e **não criou
  nada**. Se o user não responde, o lembrete some. Fix: criar com default sensato (manhã=09h,
  tarde=14h) OU abrir pending_intent que sobrevive, em vez de só perguntar e largar.
- **Confirmação que não persiste (inventário por foto):** alguns "Sim" de confirmação foram
  flagados sem marker executado → possível falha real de persistência no fluxo foto→confirma.
  **PRECISA de check focado** (confirmar se os instrumentos entraram no `inventario`).
- **HABIT log (Jhonatan):** caiu de 4×→1× com o fix de prompt de 31/05. Quase resolvido.

### 5. Infra (recorrente, com fallback — baixa urgência)
- 6× "Claude timeout 60000ms" → fallback OpenAI cobre. Avaliar subir timeout p/ 90s.
- 5× "Realtime canal instável" → reconexão automática, benigno. Monitorar.

## Plano cirúrgico (prioridade)
1. **Precisão das métricas** (CHECK 4 timing-aware; ACTIONABLE_NO_MARKER exclui ack/fluxo).
   Mata o ruído diário sem esconder problema real. Baixo risco (só observabilidade).
2. **Miss real — lembrete com detalhe faltando** (prompt): criar/segurar em vez de largar.
3. **Investigar persistência inventário foto→confirma** (check focado antes de qualquer fix).
4. **Infra:** subir timeout Claude p/ 90s (1 linha) se confirmar que os 6× viram fallback.

Tudo um de cada vez, com verificação. Nada de editar 4 subsistemas de uma vez.
