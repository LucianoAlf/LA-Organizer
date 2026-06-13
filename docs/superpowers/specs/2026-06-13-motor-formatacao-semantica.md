# Motor de Formatação Semântica do TOM (Anotações) — Design

**Data:** 2026-06-13
**Autor:** Claude + Alf
**Fatia:** D (evolução do "Formatar com o TOM" das anotações de grupo)
**Status:** aprovado o design (aguarda review da spec)

---

## 1. Problema (causa-raiz)

A Rose usou o "Formatar com o TOM" nas Contas a Pagar (texto embolado, tudo numa
descarga mental) e o resultado foi ruim: **"ele só deixou em negrito o início do
texto, não separou uma conta da outra, continuou bagunçado, só negrito alguns."**

Ao mesmo tempo, em outra execução o resultado saiu ótimo (print do Alf). **Mesma
feature, qualidade-sorteio** — porque o prompt do motor é vago. Hoje a ação
`format` (`src/services/format-note.js`) diz:

> "Use títulos, listas e negrito **onde fizer sentido**. Preserve TODOS os dados."

Esse "onde fizer sentido" + "preserve tudo" empurra o modelo pro caminho
conservador: engorda o título, deixa o resto como está. Nada manda **separar cada
item**, **detectar/agrupar por categoria**, usar **molde/subdivisão/quebra**, e
não há **exemplo** pra o modelo se espelhar. Sem isso, varia.

## 2. Objetivo

Transformar o motor de formatação em **semântico por padrão**: dada uma descarga
mental misturada, o TOM **identifica o que é conta, tarefa, senha, saldo…**,
**separa cada item em bloco próprio** e **agrupa por categoria** com
título/subdivisão/quebra — de forma **confiável** (com exemplo no prompt). Isso
roda **por baixo de TODAS as ações** existentes (não é "mais uma opção"). Mais:

- **Instrução livre** (pedido da Rose): "formata desse jeito pra mim".
- **Toggle de emojis** (semântica sempre ligada).

### Não-objetivos (desta fatia)

- **Não** extrair tarefa → tarefa real no sistema, nem senha → campo secreto
  automático. A separação é **dentro da própria anotação** (estrutura visual).
  Extração de verdade é uma fatia futura.
- **Não** trocar modelo nem auth. Já roda **Sonnet via assinatura OAuth**.

## 3. Restrições (invioláveis)

- **Assinatura OAuth, nunca API key.** Confirmado em `src/ai/claude.js`: o caminho
  `claude.chatRaw` → CLI `claude -p` autenticado por `CLAUDE_CODE_OAUTH_TOKEN`,
  **sem fallback OpenAI** e sem depender de `ANTHROPIC_API_KEY`. Modelo = `sonnet`
  (`CLAUDE_MODEL`, Sonnet 4.6). **Nada disso muda.**
- Tudo em PT-BR.
- A correção é **o prompt** + pequenos ajustes de wiring/UI. O caminho de produção
  do WhatsApp (`chat()` + sanitizer) **não é tocado**.

## 4. Abordagem escolhida

**A — Reescrever o prompt do motor + few-shot, mesma chamada Sonnet/OAuth.** Uma
chamada só (preview rápido). O exemplo concreto é o maior redutor da variação.

Descartadas: **B** (duas passadas classifica→renderiza: 2× lento, complexo, YAGNI);
**C** (parser regex no backend: frágil, só serve pro formato de contas).

## 5. Arquitetura / componentes

```
PWA RichEditor (menu: Organizar/Resumir/Corrigir/Claro + "Do meu jeito" + emoji toggle)
  → formatNote(action, html, {instruction, emoji})           web/src/lib/formatNote.ts
  → POST /internal/format-note {action, html, instruction, emoji}   src/internal-api.js
  → validateFormatRequest(body)                              src/services/format-note.js (puro)
  → systemPromptFor(action, {instruction, emoji})            src/services/format-note.js (puro)
  → claude.chatRaw(systemPrompt, html)                       src/ai/claude.js (OAuth, intocado)
  → FormatPreview (antes/depois) → Aplicar/Descartar         web/src/screens/grupos/notes/FormatPreview.tsx
```

O motor (`format-note.js`) é **puro e compartilhado**. Quando as Anotações
pessoais adotarem o `RichEditor` (fatia do espelho), **herdam isto de graça**.

## 6. O motor — texto exato dos prompts (`src/services/format-note.js`)

### 6.1 Constantes

```js
const ACTIONS = ['format', 'summarize', 'fix', 'tone'];
const MAX_HTML = 20000;
const MAX_INSTRUCTION = 280;
```

### 6.2 Núcleo semântico (herdado por todas as ações) + few-shot

```js
const SEMANTIC_CORE =
`Você é o TOM organizando uma anotação de trabalho que chegou como uma "descarga mental": itens misturados, sem estrutura, tudo embolado. Sua tarefa é DAR ESTRUTURA sem perder nada.

Regras obrigatórias (não são opcionais):
1. IDENTIFIQUE as categorias que aparecem no texto e crie uma seção <h2> para cada uma que EXISTIR. Categorias comuns: Contas a pagar, Contas a receber, Tarefas e pendências, Senhas e acessos, Saldos, Contatos, Prazos e datas, Observações. Só crie a seção se a categoria realmente aparecer — nunca invente seção vazia. O que não se encaixar vai em "Outros".
2. CADA item é um <li> próprio dentro da <ul> da sua seção. NUNCA junte dois itens na mesma linha — cada conta, cada tarefa, cada senha é um <li> separado.
3. DESTAQUE em <strong> o que identifica o item (nome + valor).
4. A sub-informação do item (forma de pagamento, código de barras, contato, vencimento, observação) entra DENTRO do mesmo <li>, como continuação separada por <br>. NUNCA vira item solto e NUNCA some.
5. PRESERVE 100% dos dados: números, valores, códigos de barras, e-mails e telefones saem idênticos ao original. Não invente, não remova.

Exemplo de transformação:

ENTRADA:
contas a pagar hoje
pg seguro carro 131,98 boleto 34191.09800 18865
pg internet 82,99 debito automatico
ligar pro contador ate sexta
senha portal nfe gov2024

SAÍDA:
<h2>Contas a pagar</h2>
<ul>
<li><strong>Seguro carro</strong> — <strong>R$ 131,98</strong><br>Boleto: 34191.09800 18865<br>Forma: boleto</li>
<li><strong>Internet</strong> — <strong>R$ 82,99</strong><br>Forma: débito automático</li>
</ul>
<h2>Tarefas e pendências</h2>
<ul>
<li>Ligar pro contador <strong>até sexta</strong></li>
</ul>
<h2>Senhas e acessos</h2>
<ul>
<li><strong>Portal NFe</strong><br>Senha: gov2024</li>
</ul>`;
```

### 6.3 Verbo por ação

```js
const ACTION_VERBS = {
  format:
    'Organize a anotação abaixo aplicando exatamente as regras acima.',
  summarize:
    'Aplique a estrutura das regras acima E condense cada seção: bullets curtos, sem redundância nem enrolação — mas mantenha todos os itens e seus dados essenciais.',
  fix:
    'Sua prioridade é CORRIGIR ortografia e gramática em português. Aplique também a estrutura das regras acima. NÃO altere números, valores, códigos ou e-mails.',
  tone:
    'Reescreva num tom mais claro, objetivo e profissional, aplicando a estrutura das regras acima. Mantenha todas as informações.',
};
```

### 6.4 Emoji + COMMON

```js
const EMOJI_ON =
  '\n\nUse 1 emoji como marcador no início de CADA título de seção (ex.: 💰 Contas a pagar, 📥 Contas a receber, ✅ Tarefas e pendências, 🔑 Senhas e acessos, 💵 Saldos, 📞 Contatos, 🗓️ Prazos e datas). Um por título, nenhum dentro dos itens.';
const EMOJI_OFF =
  '\n\nNÃO use emojis.';
const COMMON =
  '\n\nResponda APENAS o HTML do corpo — sem cercas de código, sem texto antes ou depois, sem comentário. Use só estas tags: <h2>, <p>, <ul>, <li>, <strong>, <em>, <a>, <br>. NÃO invente informação que não esteja no original.';
```

### 6.5 Funções puras

```js
function validateFormatRequest(body) {
  const action = body && body.action;
  const html = body && body.html;
  if (!ACTIONS.includes(action)) return { ok: false, error: 'invalid_action' };
  if (typeof html !== 'string' || !html.trim()) return { ok: false, error: 'invalid_html' };
  if (html.length > MAX_HTML) return { ok: false, error: 'too_long' };
  let instruction = '';
  if (body.instruction != null) {
    if (typeof body.instruction !== 'string') return { ok: false, error: 'invalid_instruction' };
    instruction = body.instruction.trim().slice(0, MAX_INSTRUCTION);
  }
  const emoji = body.emoji !== false; // default ligado
  return { ok: true, action, html, instruction, emoji };
}

function systemPromptFor(action, opts = {}) {
  const verb = ACTION_VERBS[action] || ACTION_VERBS.format;
  const instruction = String(opts.instruction || '').trim();
  const emoji = opts.emoji !== false;
  const instrClause = instruction
    ? `\n\nINSTRUÇÃO DO USUÁRIO (prioridade — siga, mas sem apagar nenhum dado): ${instruction}`
    : '';
  return SEMANTIC_CORE + '\n\n' + verb + (emoji ? EMOJI_ON : EMOJI_OFF) + instrClause + COMMON;
}

module.exports = { ACTIONS, MAX_HTML, MAX_INSTRUCTION, validateFormatRequest, systemPromptFor };
```

## 7. Endpoint (`src/internal-api.js`)

Mudança mínima na rota `/internal/format-note` já existente:

```js
const v = validateFormatRequest(req.body || {});
// ...
const aiPromise = claude.chatRaw(
  systemPromptFor(v.action, { instruction: v.instruction, emoji: v.emoji }),
  v.html,
);
// log: reason inclui `action=${v.action} instr=${v.instruction ? 'y' : 'n'} emoji=${v.emoji ? 'y' : 'n'} chars=${html.length}`
```

Resto igual (race 30s, 502 `tom_unavailable` em falha, `NOTE_FORMATTED` em
`marker_logs`). Auth `requireInternalSecret` intocada. Pré-prod (JWT+rate-limit)
segue pendente, registrado no known-issue.

## 8. Client (`web/src/lib/formatNote.ts`)

```ts
export async function formatNote(
  action: FormatAction,
  html: string,
  opts?: { instruction?: string; emoji?: boolean },
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  // ...
  body: JSON.stringify({ action, html, instruction: opts?.instruction, emoji: opts?.emoji }),
}
```

## 9. UI (`web/src/screens/grupos/notes/RichEditor.tsx`)

Reestruturar o menu "✨ Formatar com o TOM":

- **"✨ Organizar (recomendado)"** → `runIa('format')` (item de destaque no topo).
- **"Resumir"** → `runIa('summarize')`.
- **"Corrigir ortografia"** → `runIa('fix')`.
- **"Deixar mais claro"** → `runIa('tone')`.
- divisória.
- **"Formatar do meu jeito…"** → abre um `<textarea>` inline (placeholder:
  *"Diz pro TOM como quer: ex. 'separa por loja e põe o total no fim'"*) + botão
  **Aplicar** → `runIa('format', instrText)`.
- rodapé: toggle **"Usar emojis"** (default ligado, persistido em
  `localStorage['tom_notes_emoji']`). Afeta todas as execuções.

`runIa(action, instruction?)` passa `{ instruction, emoji: useEmoji }`. Todas as
ações continuam caindo no mesmo `FormatPreview` (antes/depois → Aplicar/Descartar).
Sem `<select>`/`<button>` nativos novos fora do padrão do DS já usado no arquivo.

## 10. Testes

`src/services/format-note.test.js` (node --test, puro — estende o existente):

- **validate:** mantém `invalid_action` / `invalid_html` / `too_long`; aceita
  `instruction` string e devolve trimada; `invalid_instruction` se não-string;
  trunca instrução >280; `emoji` default `true`; `emoji:false` respeitado.
- **systemPromptFor:** o núcleo (âncora: `'cada conta, cada tarefa'` ou
  `'CADA item é um <li>'`) aparece nas **4** ações; o verbo certo aparece por ação
  (ex.: `fix` contém "CORRIGIR ortografia"); o few-shot aparece (âncora:
  `'ENTRADA:'`); com `instruction` o bloco "INSTRUÇÃO DO USUÁRIO" aparece, sem ela
  não; `emoji:true` contém "1 emoji"/"💰", `emoji:false` contém "NÃO use emojis".

Validação local: `node --test`, `npx tsc --noEmit`, `npx vite build`.

Validação e2e (read-only / ficha descartável — **preview muta dado REAL**): criar
ficha de teste com a descarga mental de contas → "Organizar" → conferir no preview
que cada conta virou `<li>` separado, agrupado por seção; testar "Do meu jeito"
com uma instrução; testar emoji on/off; **Descartar** (não salva) ou apagar a ficha
de teste no fim.

## 11. Deploy

- Backend (`format-note.js`, `internal-api.js`): SCP + `pm2 restart tom`.
- PWA (`formatNote.ts`, `RichEditor.tsx`): auto-deploy hook no fim do turno.

## 12. Registro

`tom_known_issues`: novo `GROUPNOTES-FORMAT-SEMANTIC` (área `marker`/anotações) —
causa-raiz (prompt vago "onde fizer sentido" → só negrito, não separava), fix
(núcleo semântico + few-shot herdado por todas as ações + instrução livre + toggle
emoji; Sonnet/OAuth intocado), sinal de reincidência ("formatou mas não separou os
itens / juntou tudo numa linha").

## 13. Arquivos

| Arquivo | Ação |
|---|---|
| `src/services/format-note.js` | reescrever prompts + validate/systemPromptFor |
| `src/services/format-note.test.js` | estender testes |
| `src/internal-api.js` | passar `{instruction, emoji}` + log |
| `web/src/lib/formatNote.ts` | aceitar `opts {instruction, emoji}` |
| `web/src/screens/grupos/notes/RichEditor.tsx` | menu + instrução + toggle emoji |
