# Design — "TOM endereçado" no chat de grupo

**Data:** 2026-06-19
**Status:** aprovado no brainstorm (Alf) — pronto pra writing-plans
**Área:** `realtime` / chat de grupo
**Relacionados:** [[project_groupchat_fail_silent]], [[project_tom_ai_timeout_latency]], [[project_groupchat_phantom_pool]], `AI-TIMEOUT-120S-QUEUE-STALL`, `GROUPCHAT-FAIL-NOPROSE-SILENT`

---

## Problema

No chat de grupo o TOM está **entrometido**: uma vez "aceso", ele responde a **toda** mensagem por 8 minutos — inclusive reações ("😮"), agradecimentos ("Arrasou", "obrigado") e papo paralelo entre as pessoas. Cada uma dessas mensagens dispara uma **chamada de IA completa**, mesmo quando ele corretamente decide ficar calado.

Consequências reais (medidas):
1. **Gasto** — dezenas de chamadas Claude à toa numa conversa animada.
2. **"Escrevendo… e não fala nada"** — o indicador "Tom escrevendo…" dispara **antes** de ele decidir se vai falar; quando cala, o indicador já apareceu e nada vem.
3. **Trava os outros** — todas as chamadas entram na **mesma fila serializada** de IA; uma que trava (timeouts de 120s vistos no log) segura quem realmente chamou o TOM.

### Evidência (log de produção 2026-06-19, grupo Financeiro)
```
21:08:07 [AI] Claude ok dur=7123ms out=213tok   ← respondeu "Meninas o Tom já está lendo PDF"
21:08:14 [AI] Claude ok dur=2350ms out=9tok     ← "respondeu" (em silêncio) ao "😮"
21:08:22 [AI] Claude ok dur=2982ms out=9tok     ← "respondeu" (em silêncio) ao "Arrasou"
```
`out=9tok` = o TOM emitindo o marcador de silêncio. Cada um custou uma chamada Claude inteira na fila.

### Diagnóstico de causa-raiz (auditoria do código)
- O gatilho de menção **já existe** (`group-chat-triggers.js` → `detectEngageTrigger`, regex `/(^|[\s,!?@])tom\b/i`). O problema **não** é "qualquer citação dispara".
- O problema é o **modelo de sessão** em `group-chat-watcher.js` → `processOne`: `if (engaged) { shouldRun = true; }` — enquanto a sessão de 8 min está aberta, **toda** mensagem de membro chama o engine (e portanto a IA).
- O regex atual também acorda em menções **sobre** o TOM ("**o** Tom já está lendo PDF"), não só em chamados **pra** ele.
- O "Tom escrevendo…" (`sendGroupTyping`, watcher linha ~65) dispara em todo `shouldRun`, antes de saber se haverá resposta.

Não há known issue registrado pra essa causa-raiz (é vizinha de `AI-TIMEOUT-120S-QUEUE-STALL` e `GROUPCHAT-FAIL-NOPROSE-SILENT`, mas distinta).

---

## Princípio

> O TOM **ouve tudo** (toda mensagem continua salva e ele a lê como contexto quando vai falar), mas **só escreve quando endereçado**.

A decisão de responder deixa de ser "está numa sessão de 8 min" e passa a ser **por mensagem**, num **pré-filtro determinístico (sem IA)** dentro do watcher. **Não muda nada no jeito/tom/tamanho das respostas** (comportamento do TOM é sagrado) — muda só **quando** ele fala.

## Decisões do brainstorm (Alf)
1. **Modelo:** Híbrido — responde quando endereçado; exceção é quando foi **ele** que perguntou (preserva os "sim/não").
2. **Gatilho:** chamado **direto/vocativo** — não acorda em menção *sobre* ele.
3. **Reply (item b):** fica como **fast-follow** (precisa de migração + bridge-in); o núcleo (a + c) sobe primeiro, **zero migração**.

---

## Design — v1 (núcleo, zero migração)

### 1. Quando o TOM responde — `isAddressedToTom`
Responde se **qualquer** destes for verdadeiro:

- **(a) Vocativo** — "Tom" como chamado direto (ver `isVocativeTom` abaixo).
- **(b) Reply** — deu "responder" numa mensagem do próprio TOM. **Sempre `false` no v1** (entra no fast-follow); o parâmetro já existe na assinatura.
- **(c) Esperando resposta dele** — o TOM acabou de pedir algo e a próxima mensagem é a resposta. Verdadeiro se:
  - existe linha **fresca** em `group_chat_pending_confirms` pro grupo (cobre os "sim/não" estruturados: apagar ficha, encerrar série); **OU**
  - a última mensagem `role='tom'` `kind='text'` do grupo foi criada há ≤ `AWAIT_WINDOW_MS` (3 min) **e** seu texto termina com `?` (cobre pergunta livre: "Qual o valor?" → "R$ 320").

Qualquer outra mensagem → **silêncio real**: nenhuma chamada de IA, nenhum "escrevendo…".

### 2. `isVocativeTom(text)` — função pura, TDD
"Tom" conta como chamado **a não ser** que esteja precedido de artigo/preposição (= falando *sobre* ele).

- **Acorda:** `@tom`; "Tom" no início (`"Tom, faz X"`, `"Tom?"`); "Tom" precedido de palavra que **não** é artigo/preposição (`"fala tom"`, `"ei tom"`, `"bom dia Tom!"`).
- **NÃO acorda:** "**o** Tom já leu", "manda **pro** Tom", "falar **com o** Tom", "**do** Tom".
- **Não casa substring:** `\btom\b` (ASCII, seguro) — "automático", "tombou", "fantom" não acordam.

`VOCATIVE_STOPWORDS = ['o','a','os','as','do','da','dos','das','pro','pra','pros','pras','ao','aos','à','às','com','de','no','na','nos','nas','um','uma']` (constante exportada).

Implementação: localizar cada match `\btom\b` (case-insensitive), olhar o token imediatamente anterior; acorda se não houver token anterior (início) **ou** o token anterior (sem acento/pontuação) não estiver no stoplist **ou** for precedido de `@`.

### 3. "Escrevendo…" honesto
`sendGroupTyping` só dispara **dentro do ramo de resposta** (depois do pré-filtro decidir `addressed`). Como o gate agora é `addressed` (não `engaged`), o "escrevendo fantasma" some pra todo o papo paralelo. (Borda residual: `addressed=true` mas o engine ainda emite silêncio → "escrevendo" sem fala. Raro; aceito no v1, refino opcional = limpar presença no silêncio.)

### 4. Sessão + card de fechamento — preservados
- `tom_chat_engaged_at` continua sendo o **início da sessão** (pro card de "Pendências da conversa" e pra memória). Passa a ser setado quando o TOM é **endereçado** (não em papo paralelo).
- Se ninguém endereçar o TOM, `engaged_at` fica `null` → sem sessão, sem card, TOM 100% mudo (o "só aparece quando chamam" que o Alf quer).
- Fechamento por **despedida ao TOM** (`detectDisengageTrigger`, ex.: "valeu Tom") ou **ociosidade 8 min** — inalterado. `sweepEngaged` inalterado.

### 5. Novo `processOne` (esqueleto)
```
text = conteúdo + extração de mídia            // inalterado
vocative = isVocativeTom(text)
engaged  = isEngaged(group.tom_chat_engaged_at)
tomAwaiting = false
if (!vocative) tomAwaiting = await computeTomAwaiting(supabase, group.id)  // 2 queries baratas, só quando precisa
addressed = vocative || /* reply v1=false */ tomAwaiting

if (addressed && detectDisengageTrigger(text)) { responder; clearAfter = true }
else if (addressed) { responder; if (!engaged) abre sessão (engaged_at = now, closed_session_at = null) }
else return    // SILÊNCIO: sem typing, sem engine

// ramo responder:
if (group.wa_group_jid) sendGroupTyping(...)   // só aqui
await processGroupChatMessage({...})
if (clearAfter) engaged_at = null
```

`computeTomAwaiting`:
- `select 1 from group_chat_pending_confirms where group_id=? and expires_at > now() limit 1` → pendingConfirm.
- última `role='tom' kind='text'`: `created_at >= now()-AWAIT_WINDOW_MS` e `content.trim().endsWith('?')` → lastTomQuestion.
- retorna `pendingConfirm || lastTomQuestion`.

---

## Raio de alteração
- `src/services/group-chat-triggers.js` — `isVocativeTom`, `isAddressedToTom`, `VOCATIVE_STOPWORDS`, `AWAIT_WINDOW_MS` (funções puras). `detectEngageTrigger` vira wrapper de `isVocativeTom` (compat) ou é substituído nos call sites.
- `src/services/group-chat-watcher.js` — `processOne` (pré-filtro + ordem do typing) + helper `computeTomAwaiting`.
- **Zero toque:** `group-chat-engine.js`, prompt, recorrência, bridge-in/out, RLS. Sem migração.

## Testes
**Unit (`node --test`, cwd `_remote`):**
- `isVocativeTom`: acorda em `["Tom, faz isso","@tom","fala tom","Ei Tom","bom dia Tom!","Tom?"]`; NÃO acorda em `["o Tom já leu","manda pro Tom","falar com o Tom","do Tom","isso é automático","tombou a barraca"]`.
- `isAddressedToTom`: cobre as 3 combinações (vocative / awaiting / nenhum).

**Smoke ao vivo (VPS, grupo descartável `2f1b37d1-…`, ids falsos):**
1. Sessão aberta + mensagem **não** endereçada ("kkkk", "😮") → **nenhuma** resposta + **nenhuma** chamada `[AI]` nos logs.
2. Vocativo ("Tom, status?") → responde.
3. `pending_confirm` fresca + "sim" (sem "Tom") → engine roda e confirma.
4. Última fala do TOM termina com "?" + resposta sem "Tom" dentro de 3 min → responde; fora de 3 min → silêncio.

## Rollout
`scp` dos 2 arquivos + `pm2 restart tom` → smoke no grupo descartável → registrar known issue `GROUPCHAT-OVERENGAGE-PERMSG` (área `realtime`, causa-raiz + fix_resumo + sinal_padrao) → memória de projeto.

## Fora de escopo (fast-follows)
- **Reply (item b):** migração `group_chat_messages.reply_to_wa_id` + captura do `stanzaID` citado no **bridge-in** + watcher casa `reply_to_wa_id` com `wa_message_id` de uma mensagem `role='tom'` → `isReplyToTom=true`. Spec própria depois do núcleo validado.
- Limpar a presença "escrevendo" quando o engine decide silêncio mesmo endereçado (refino).
- Paralelizar a fila de IA (trilha separada — [[project_paralelismo_cli_fase0]]).

## Riscos & mitigação
- **Vocativo estrito demais (perde um chamado real):** stoplist conservador (só artigo/preposição); "Tom" no início **sempre** acorda; coberto por teste.
- **Awaiting super-dispara (resposta do TOM tinha "?"):** limitado a janela de 3 min + consumido na 1ª resposta; custo = 1 chamada extra eventual, aceitável.
- **Desacoplar sessão de resposta quebra o card:** não — `engaged_at` é setado no endereçamento e o `sweepEngaged`/fechamento ficam intactos.
