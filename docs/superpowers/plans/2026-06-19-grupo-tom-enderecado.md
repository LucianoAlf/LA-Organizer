# Plano — "TOM endereçado" no chat de grupo (v1, núcleo)

> **Para workers agênticos:** SUB-SKILL OBRIGATÓRIA: executar inline (superpowers:executing-plans), task a task, TDD. Passos com checkbox `- [ ]`.

**Goal:** No chat de grupo, o TOM passa a **ouvir tudo mas só responder quando endereçado** (vocativo OU ele estar esperando resposta), num pré-filtro determinístico sem IA — matando o gasto, o "escrevendo fantasma" e o trava-fila.

**Architecture:** Toda a decisão "responder?" vira função pura testável em `group-chat-triggers.js` + um helper de I/O barato no watcher. `processOne` troca o gate `engaged → responde a tudo` por `addressed → responde`. Zero toque em engine/prompt/recorrência/bridge-in. Sem migração.

**Tech Stack:** Node CJS (`_remote/src`), `node --test`/`node --check`, deploy `scp tom:` + `pm2 restart`, smoke ao vivo com `node --env-file=.env`.

**Spec:** `_remote/docs/superpowers/specs/2026-06-19-grupo-tom-enderecado-design.md`

---

## Estrutura de arquivos
- **Modificar** `src/services/group-chat-triggers.js` — `VOCATIVE_STOPWORDS`, `AWAIT_WINDOW_MS`, `_normToken`, `isVocativeTom`, `isAddressedToTom`; `detectEngageTrigger` vira alias de `isVocativeTom`; exports.
- **Modificar** `src/services/group-chat-triggers.test.js` — estende com casos vocativo + endereçamento (os atuais continuam verdes).
- **Modificar** `src/realtime/group-chat-watcher.js` — `computeTomAwaiting` (exportado) + reescrita do gate em `processOne` + ordem do `sendGroupTyping` + imports.
- **Criar (temporário, só VPS)** `/opt/LA-Organizer/_smoke_enderecado.js` — smoke, apagado no fim.

Convenção do repo: **não commitar entre tasks**; validar com `node --check`/`node --test`; deploy real só na Task 6 (scp + pm2). Todos os `node --test`/`--check` rodam com **cwd `_remote`** (`cd /d/la-organizer/_remote && ...`).

---

### Task 1: `isVocativeTom` — "Tom" como chamado direto, não menção sobre ele

**Files:**
- Modify: `src/services/group-chat-triggers.js`
- Test: `src/services/group-chat-triggers.test.js`

- [ ] **Step 1: Escrever os testes que falham**

No topo do test file, ajustar o import:
```js
const { detectEngageTrigger, detectDisengageTrigger, isEngaged, isVocativeTom, isAddressedToTom } = require('./group-chat-triggers');
```
Adicionar ao fim do arquivo:
```js
test('isVocativeTom: acorda em chamado direto (vocativo)', () => {
  ['Tom, faz isso', '@tom', 'fala tom', 'Ei Tom', 'bom dia Tom!', 'Tom?', 'TOM', 'e aí tom, beleza?'].forEach((t) =>
    assert.equal(isVocativeTom(t), true, `devia acordar: ${t}`));
});

test('isVocativeTom: NÃO acorda em menção SOBRE ele nem em substring', () => {
  ['o Tom já leu', 'manda pro Tom', 'falar com o Tom', 'do Tom', 'isso é automático', 'a árvore tombou', 'fantom da ópera', '', null].forEach((t) =>
    assert.equal(isVocativeTom(t), false, `NÃO devia acordar: ${t}`));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/services/group-chat-triggers.test.js`
Expected: FAIL (`isVocativeTom is not a function`).

- [ ] **Step 3: Implementar**

Em `group-chat-triggers.js`, **antes** de `detectEngageTrigger`, adicionar:
```js
// Artigos/preposições que, ANTES de "tom", indicam que se fala SOBRE ele (não um chamado).
const VOCATIVE_STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'pro', 'pra', 'pros', 'pras',
  'ao', 'aos', 'com', 'de', 'no', 'na', 'nos', 'nas', 'um', 'uma',
]);

// Normaliza um token pra a-z minúsculo sem acento/pontuação (p/ comparar no stoplist).
function _normToken(tok) {
  return String(tok || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

// "Tom" como CHAMADO DIRETO (vocativo), não menção sobre ele.
// Acorda: "@tom"; "Tom" no início; "Tom" precedido de palavra fora do stoplist ("fala tom", "bom dia Tom").
// NÃO acorda: "o Tom", "pro Tom", "com o Tom" (sobre ele); nem substring ("automático", "tombou", "fantom").
function isVocativeTom(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  if (/@tom\b/.test(lower)) return true;                  // @tom é sempre chamado
  const words = lower.split(/[^a-zà-ú@]+/i).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (_normToken(words[i]) !== 'tom') continue;
    if (i === 0) return true;                             // "Tom ..." no início
    if (!VOCATIVE_STOPWORDS.has(_normToken(words[i - 1]))) return true; // precedido de não-stopword
    // precedido de artigo/preposição → menção sobre ele; segue procurando outra ocorrência
  }
  return false;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /d/la-organizer/_remote && node --test src/services/group-chat-triggers.test.js`
Expected: PASS (inclui os testes antigos de `detectEngageTrigger`).

---

### Task 2: `isAddressedToTom` + `AWAIT_WINDOW_MS`

**Files:**
- Modify: `src/services/group-chat-triggers.js`
- Test: `src/services/group-chat-triggers.test.js`

- [ ] **Step 1: Testes que falham**

Adicionar ao test file:
```js
test('isAddressedToTom: vocativo OU reply OU awaiting → true; nada → false', () => {
  assert.equal(isAddressedToTom({ text: 'Tom, status?' }), true);
  assert.equal(isAddressedToTom({ text: 'kkk que isso', isReplyToTom: true }), true);
  assert.equal(isAddressedToTom({ text: 'sim', tomAwaiting: true }), true);
  assert.equal(isAddressedToTom({ text: 'depois eu vejo isso' }), false);
  assert.equal(isAddressedToTom({ text: 'o Tom já respondeu' }), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/services/group-chat-triggers.test.js`
Expected: FAIL (`isAddressedToTom is not a function`).

- [ ] **Step 3: Implementar**

Em `group-chat-triggers.js`, após `isVocativeTom`:
```js
// Janela em que uma resposta a uma PERGUNTA do TOM conta sem precisar repetir o nome.
const AWAIT_WINDOW_MS = 3 * 60 * 1000;

// Endereçamento: o TOM só fala se for vocativo, reply à msg dele, ou se ele estava esperando.
// (isReplyToTom entra no fast-follow; no v1 vem sempre false do watcher.)
function isAddressedToTom({ text, isReplyToTom = false, tomAwaiting = false } = {}) {
  return isVocativeTom(text) || !!isReplyToTom || !!tomAwaiting;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /d/la-organizer/_remote && node --test src/services/group-chat-triggers.test.js`
Expected: PASS.

---

### Task 3: `detectEngageTrigger` vira alias + exports + `node --check`

**Files:**
- Modify: `src/services/group-chat-triggers.js`

- [ ] **Step 1: Alias + exports**

Trocar a função `detectEngageTrigger` (a que usa `ENGAGE_RE`) por um alias e atualizar o `module.exports`. Remover o `ENGAGE_RE` agora não-usado (deixar `DISENGAGE_RE`/`FAREWELL_RE`). Resultado do bloco de exports:
```js
// Compat: o gatilho de engajamento agora é o vocativo (mais estrito — não acorda em "o Tom").
const detectEngageTrigger = isVocativeTom;

module.exports = {
  detectEngageTrigger, detectDisengageTrigger, isEngaged, isVocativeTom, isAddressedToTom,
  VOCATIVE_STOPWORDS, AWAIT_WINDOW_MS, ENGAGE_WINDOW_MIN, ENGAGE_MAX_HOURS,
};
```

- [ ] **Step 2: Validar**

Run: `cd /d/la-organizer/_remote && node --check src/services/group-chat-triggers.js && node --test src/services/group-chat-triggers.test.js`
Expected: PASS, sem erro de sintaxe. (Os testes antigos de `detectEngageTrigger` continuam verdes porque seus casos não incluem "o Tom".)

---

### Task 4: `computeTomAwaiting` no watcher (exportado p/ smoke)

**Files:**
- Modify: `src/realtime/group-chat-watcher.js`

- [ ] **Step 1: Atualizar import + adicionar helper**

Linha 14 — trocar o require por:
```js
const { detectDisengageTrigger, isEngaged, isVocativeTom, isAddressedToTom, AWAIT_WINDOW_MS } = require('../services/group-chat-triggers');
```
Adicionar, **antes** de `processOne`:
```js
// "O TOM está esperando uma resposta?" — sinal barato (sem IA) pra deixar passar um "sim"/"R$ 320"
// sem precisar repetir o nome. Degrada gracioso: na dúvida, retorna false (silêncio).
async function computeTomAwaiting(supabase, groupId) {
  // (1) confirmação estruturada pendente (apagar ficha / encerrar série).
  try {
    const { data: pend } = await supabase.from('group_chat_pending_confirms')
      .select('id').eq('group_id', groupId).gt('expires_at', new Date().toISOString()).limit(1);
    if (pend && pend.length) return true;
  } catch (_) { /* segue */ }
  // (2) última fala do TOM foi pergunta livre ("...?") dentro da janela.
  try {
    const cutoff = Date.now() - AWAIT_WINDOW_MS;
    const { data: tomMsgs } = await supabase.from('group_chat_messages')
      .select('content, created_at').eq('group_id', groupId).eq('role', 'tom').eq('kind', 'text')
      .order('created_at', { ascending: false }).limit(1);
    const last = (tomMsgs || [])[0];
    if (last && new Date(last.created_at).getTime() >= cutoff && String(last.content || '').trim().endsWith('?')) return true;
  } catch (_) { /* segue */ }
  return false;
}
```
No `module.exports` do final do arquivo, acrescentar `computeTomAwaiting`:
```js
module.exports = { startGroupChatWatcher, tick, computeTomAwaiting };
```

- [ ] **Step 2: Validar**

Run: `cd /d/la-organizer/_remote && node --check src/realtime/group-chat-watcher.js`
Expected: OK (sem saída = sucesso).

---

### Task 5: Reescrever o gate de `processOne` + "escrevendo" honesto

**Files:**
- Modify: `src/realtime/group-chat-watcher.js`

- [ ] **Step 1: Substituir o bloco de decisão**

Em `processOne`, trocar o trecho que vai de `const { data: group } = ...` até logo antes de `await processGroupChatMessage(...)` por:
```js
  const { data: group } = await supabase.from('work_groups')
    .select('tom_chat_engaged_at, wa_group_jid').eq('id', msg.group_id).maybeSingle();
  const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

  // ── Pré-filtro determinístico (SEM IA): o TOM ouve tudo, mas só RESPONDE quando endereçado.
  const vocative = isVocativeTom(text);
  // reply entra no fast-follow (precisa de coluna + bridge-in); no v1 é sempre false.
  const tomAwaiting = vocative ? false : await computeTomAwaiting(supabase, msg.group_id);
  const addressed = isAddressedToTom({ text, isReplyToTom: false, tomAwaiting });

  let shouldRun = false, clearAfter = false;
  if (addressed && detectDisengageTrigger(text)) {
    shouldRun = true; clearAfter = true;           // "valeu Tom" → responde e fecha a sessão
  } else if (addressed) {
    shouldRun = true;
    if (!engaged) {
      // Abre a sessão (início, não desliza) só quando ENDEREÇADO — pro card de fechamento/memória.
      await supabase.from('work_groups')
        .update({ tom_chat_engaged_at: new Date().toISOString(), tom_chat_closed_session_at: null })
        .eq('id', msg.group_id);
    }
  }
  if (!shouldRun) return; // SILÊNCIO real: nada de "escrevendo…", nada de chamada de IA

  // "Tom escrevendo…" só AGORA — quando já sabemos que ele vai responder (fim do "escreve e some").
  if (group?.wa_group_jid) sendGroupTyping(group.wa_group_jid);

  await processGroupChatMessage({ supabase, groupId: msg.group_id, senderCollabId, text });
```
(O bloco `if (clearAfter) { ... }` logo abaixo permanece igual. `sweepEngaged`/recuperação de órfã/fechamento ficam intactos.)

- [ ] **Step 2: Validar sintaxe + suite de triggers**

Run: `cd /d/la-organizer/_remote && node --check src/realtime/group-chat-watcher.js && node --test src/services/group-chat-triggers.test.js`
Expected: ambos OK/PASS.

---

### Task 6: Deploy + smoke ao vivo + registro

**Files:**
- Deploy: `src/services/group-chat-triggers.js`, `src/realtime/group-chat-watcher.js`
- Create (VPS, temporário): `/opt/LA-Organizer/_smoke_enderecado.js`

- [ ] **Step 1: Deploy**

```bash
scp D:/la-organizer/_remote/src/services/group-chat-triggers.js tom:/opt/LA-Organizer/src/services/group-chat-triggers.js
scp D:/la-organizer/_remote/src/realtime/group-chat-watcher.js tom:/opt/LA-Organizer/src/realtime/group-chat-watcher.js
ssh tom "pm2 restart tom && pm2 jlist | grep -o '\"status\":\"online\"' | head -1"
```
Expected: `"status":"online"`.

- [ ] **Step 2: Smoke (grupo descartável, sem IA, sem mutar dado real)**

Escrever localmente e enviar:
```js
// _smoke_enderecado.js — valida a DECISÃO (pura + computeTomAwaiting), NÃO dispara o engine/LLM.
const supabase = require('/opt/LA-Organizer/src/supabase/client');
const T = require('/opt/LA-Organizer/src/services/group-chat-triggers');
const W = require('/opt/LA-Organizer/src/realtime/group-chat-watcher');
const SCRATCH = '2f1b37d1-33a5-4527-9fd5-2e1c58cc5af3';
(async () => {
  // 1) vocativo vs sobre-ele vs papo paralelo
  console.log('[1] vocativo "Tom, status?"      =', T.isVocativeTom('Tom, status?'));       // true
  console.log('[1] sobre-ele "o Tom já leu"     =', T.isVocativeTom('o Tom já leu'));        // false
  console.log('[1] paralelo "kkk que isso"      =', T.isVocativeTom('kkk que isso'));        // false
  // 2) gate de papo paralelo (não-vocativo, sem awaiting) → silêncio
  const awaiting = await W.computeTomAwaiting(supabase, SCRATCH);
  console.log('[2] computeTomAwaiting(scratch)  =', awaiting);
  console.log('[2] addressed(paralelo)          =', T.isAddressedToTom({ text: 'kkk que isso', tomAwaiting: awaiting })); // false esperado
  // 3) awaiting via pergunta do TOM: insere msg do tom "...?", checa, e remove
  const ins = await supabase.from('group_chat_messages')
    .insert({ group_id: SCRATCH, sender_id: null, role: 'tom', kind: 'text', content: 'Qual o valor?', channel: 'app' })
    .select('id').single();
  const awaiting2 = await W.computeTomAwaiting(supabase, SCRATCH);
  console.log('[3] awaiting após pergunta do TOM=', awaiting2);  // true esperado
  console.log('[3] addressed("R$ 320")          =', T.isAddressedToTom({ text: 'R$ 320', tomAwaiting: awaiting2 })); // true
  await supabase.from('group_chat_messages').delete().eq('id', ins.data.id); // limpa o smoke
  console.log('[CLEANUP] removido', ins.data.id);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
```
```bash
scp D:/la-organizer/_remote/_smoke_enderecado.js tom:/opt/LA-Organizer/_smoke_enderecado.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env _smoke_enderecado.js; rm -f _smoke_enderecado.js"
```
Expected: `[1] true / false / false`, `[2] addressed(paralelo) = false`, `[3] awaiting = true` e `addressed("R$ 320") = true`, `[CLEANUP] removido`. Remover também o `_smoke_enderecado.js` local.

- [ ] **Step 3: Registrar known issue + memória**

`INSERT` em `tom_known_issues` (Supabase `cesnbnrynvxvgdhfmaua`): código `GROUPCHAT-OVERENGAGE-PERMSG`, área `realtime`, status `corrigido`, causa-raiz = "sessão de 8 min respondia a TODA mensagem (1 chamada de IA por msg, mesmo pra ficar calado) + 'escrevendo' disparava antes de decidir + regex acordava em menção sobre ele"; fix = "pré-filtro determinístico isAddressedToTom (vocativo + awaiting) no watcher; typing só no ramo de resposta; vocativo estrito (stoplist de artigo/preposição)"; sinal_padrão = "out=9tok repetido / 'escrevendo' sem resposta / TOM falando em papo paralelo".
Atualizar memória `project_grupo_crud_roadmap` + ponteiro em `MEMORY.md`.

---

## Self-review (feita)
- **Cobertura da spec:** (a) vocativo → Task 1; (c) awaiting → Tasks 4-5; "escrevendo" honesto → Task 5; sessão/card preservados → Task 5 (só seta engaged no endereçamento, sweep intacto); reply (b) explicitamente fora (v1). ✅
- **Placeholders:** nenhum — todo passo tem código real. ✅
- **Consistência de tipos:** `isAddressedToTom({text,isReplyToTom,tomAwaiting})` mesma assinatura na lib (Task 2), no watcher (Task 5) e no smoke (Task 6); `computeTomAwaiting(supabase, groupId)` idem. ✅
- **Regressão dos testes atuais:** os casos antigos de `detectEngageTrigger` (alias de `isVocativeTom`) continuam verdes (nenhum usa "o Tom"). ✅
