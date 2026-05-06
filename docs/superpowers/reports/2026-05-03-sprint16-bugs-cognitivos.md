# Sprint 16 — Bugs Cognitivos (input para Sprint 17)

**Data:** 2026-05-03
**Status:** diagnóstico aprovado pelo Alf (via AlfBot) durante validação E2E
**Origem:** primeiros prints de uso real após deploy do MVP de Coordenação Conversacional

---

## Contexto

Após o deploy da Sprint 16 (commits 5a02562 + 027d660 + 484d708), o uso real revelou 7 fragilidades cognitivas. A feature funciona — TOM cria coordination_requests, dispara WhatsApp, detecta respostas, gerencia hierarquia — mas a inteligência conversacional de coordenação ainda está crua.

A frase do AlfBot resume: **"o motor está vivo, mas a camada de contexto conversacional ainda está fraca"**.

---

## 7 problemas identificados

### 1. Perda de referente anafórico
**Sintoma:** Alf disse "Agradece a ele por mim!" após TOM mostrar resposta do Rafinha. TOM perguntou "agradecer a quem? a conversa era com a Anne".

**Causa:** TOM não mantém ator ativo por thread. Pronome "ele" deveria resolver para o último colaborador mencionado em coordination_request resolvido (Rafinha), não para um interlocutor anterior (Anne).

**Prioridade:** P1 (crítico — sem isso a feature fica cansativa).

### 2. Mistura de threads paralelas
**Sintoma:** Com 4 fios ativos (Rafinha-teclado, Yuri-criativos, Anne-Recreio, Rafinha-Staner), TOM começou a misturar contextos. Quando Alf disse "Diz pra ela que está autorizado", TOM ficou confuso.

**Causa:** Não há gerenciamento de múltiplos `coordination_requests` abertos como contextos simultâneos paralelos.

**Prioridade:** P2.

### 3. Confirmação excessiva (over-clarification)
**Sintoma:** Alf disse "fala com o Rafinha sobre o teclado da sala 3 e me avisa se ele responder" — comando completo. TOM perguntou "quer que eu pergunte algo específico pro Rafinha?".

**Causa:** Skill instrui TOM a confirmar antes de emitir, mas a régua de "quando confirmar" está conservadora demais.

**Prioridade:** P3 (reduz fluidez mas não quebra).

### 4. Grounding temporal fraco
**Sintoma:** TOM disse "amanhã (domingo)" quando hoje é domingo (amanhã = segunda). Aceitou correção quando Alf apontou.

**Causa:** `resolveTemporalRef` resolve "amanhã"/"hoje" + horário em ISO, mas não há âncora explícita "Hoje é domingo" no system prompt. TOM tenta calcular dia da semana e às vezes erra.

**Prioridade:** P4.

### 5. Duplicação de cabeçalho na mensagem ao recipient ✅ FIXED (commit 484d708)
**Sintoma:** Anne recebeu "O Luciano (CEO / Fundador) me pediu pra te avisar: Alf pediu pra te avisar: amanhã ele estará no Recreio."

**Causa:** Engine adiciona cabeçalho via `_buildRecipientMessage` (UX §6); skill permitia TOM incluir prefixo "Alf pediu" dentro do `message_body` por liberdade de paráfrase.

**Fix aplicado:** Skill ganhou REGRA CRÍTICA explícita proibindo cabeçalho no message_body, com exemplos certos vs errados.

### 6. Loop de mediação incompleto
**Sintoma:** Anne respondeu "Qual horário? Eu preciso ir?" mas resposta não fechou o ciclo.

**Causa primária:** ✅ FIXED (commit 027d660) — `extractText` rejeitava `ExtendedTextMessage` (reply quote) porque `content` é objeto, não string. Mensagem da Anne foi descartada antes de chegar ao engine.

**Causa secundária (não-fixed):** mesmo com extractText fix, TOM precisa de instrução clara para emitir `<<COORDINATION_RESPONSE>>` com `request_id` exato do COORD_HINT. Detecção atual depende do LLM ser conservador.

**Prioridade:** P3 (causa primária resolvida; secundária é refinamento).

### 7. Sem thread ativa dominante
**Sintoma:** Quando Alf usou pronomes "ele/ela/isso/manda/agradece/pergunta", TOM não tinha um candidato natural (último request mencionado, última resposta recebida) para resolver.

**Causa:** É a generalização de #1 + #2. Não há conceito de "active coordination context" no prompt do TOM.

**Prioridade:** P1 (coração do problema cognitivo).

---

## Proposta arquitetural — Sprint 17

### Subsistema novo: **Active Coordination Context** (ACC)

Antes de cada chamada ao LLM, o engine constrói um bloco no system prompt com:

```
[ACTIVE_COORDINATION_CONTEXT]
- Último request criado por você: {id_short} | recipient={recipient_name} | "{preview}" | há {min}min
- Último request onde você é recipient: {id_short} | from={requester_name} | "{preview}" | há {min}min
- Última resposta recebida: {id_short} | de={recipient_name} | "{summary}" | há {min}min
- Requests abertos (sent/awaiting_response):
  • {id_short} ↔ {recipient_name} | mode={mode} | "{preview}"
  • ...

Resolução de pronomes:
- "ele/ela/esse/aquele" → tente o último ator mencionado nessa lista antes de perguntar
- "manda/confirma/autorizado" sem objeto → assuma o request mais recente em que você é recipient
- "agradece" → último ator de quem recebeu resposta

Se múltiplos candidatos com similar relevância → AÍ pergunte ao usuário, citando os candidatos pelo nome.
```

### Separação engine/skill formatter
Hoje o cabeçalho de origem está em duas camadas (engine `_buildRecipientMessage` + skill paráfrase). A skill já foi corrigida com REGRA CRÍTICA (commit 484d708) mas idealmente o engine deveria validar/strip qualquer prefixo de origem detectado no `message_body` antes de enviar — defense in depth.

### Confirmação contextual (problema 3)
Skill ganha tabela "quando perguntar":
- Sempre perguntar: relay_literal sem texto literal claro
- Perguntar se ambíguo: relay vs followup
- Não perguntar quando: comando claro com objetivo + canal + recipient identificado (ex: "fala com Rafinha sobre teclado")

### Temporal grounding (problema 4)
Adicionar âncora explícita ao system prompt:
```
Hoje é {dia_semana}, {YYYY-MM-DD}.
Amanhã é {dia_semana_amanhã}, {YYYY-MM-DD}.
Esta semana: segunda {data}, ..., domingo {data}.
```

---

## Fixes já aplicados nesta sessão

| Bug | Commit | Status |
|---|---|---|
| #5 Duplicação de cabeçalho | `484d708` | ✅ deployed |
| #6 (causa primária) Anne ExtendedTextMessage descartado | `027d660` | ✅ deployed |
| #1, #2, #7 Subsistema ACC | — | ⏳ Sprint 17 |
| #3 Over-clarification | (próximo commit) | ⏳ skill tweak |
| #4 Temporal grounding | (próximo commit) | ⏳ system prompt |
| #6 (causa secundária) Loop fechamento | — | ⏳ Sprint 17 (junto com ACC) |

---

## Critérios de sucesso para Sprint 17

A Sprint 17 será considerada bem-sucedida se, em validação real:
1. TOM resolver "ele/ela/isso/aquele" 80% das vezes sem perguntar
2. Múltiplos requests abertos não causarem confusão
3. "Manda" sem objeto resolver para o request mais recente em que Alf é recipient
4. Mensagens ao recipient não terem duplicação de cabeçalho (regressão check)
5. TOM saber dia da semana atual com confiança

---

## Frase-chave do diagnóstico

> "A feature funciona, mas a inteligência conversacional de coordenação ainda está operacionalmente promissora, mas cognitivamente frágil."

Sprint 17 endereça a fragilidade cognitiva.
