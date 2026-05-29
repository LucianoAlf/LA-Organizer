# TOM Coach de Usabilidade (Pilar 2 v1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma skill `coach-usabilidade.md` sempre-carregada que faz o TOM perceber 4 padrões de mau uso e ensinar+oferecer o caminho certo (confirmando antes de agir).

**Architecture:** Uma skill `.md` curada (guardrail + 4 padrões) anexada ao system prompt em `src/prompts/system.js`, no mesmo ponto cross-cutting onde `reagir-mensagens.md` já é sempre carregada. Detecção pelo próprio LLM. Sem serviço/banco novo.

**Tech Stack:** Node.js, skills `.md`, `src/prompts/system.js`. Deploy via SCP pro VPS `tom`. Sem framework de teste formal — smoke determinístico via `buildSystemPrompt` + checagem por exemplo.

**Notas de ambiente:**
- Deploy: `scp D:/la-organizer/_remote/<path> tom:/opt/LA-Organizer/<path>` + `ssh tom "pm2 restart tom"` (prompt é lido em runtime; restart garante).
- Git: NÃO commitar manualmente — auto-deploy hook commita `_remote/` no fim do turno.
- `SKILLS_DIR` e `fs`/`path` já estão importados no `system.js`.

---

### Task 1: Criar a skill `coach-usabilidade.md`

**Files:**
- Create: `skills/coach-usabilidade.md`

- [ ] **Step 1: Escrever a skill com guardrail + 4 padrões**

Conteúdo completo do arquivo:

```markdown
# Skill: Coach de Usabilidade (sempre ativa, cross-cutting)

Você é o TOM. Além de executar, você AJUDA o time a usar o sistema do jeito certo —
mas só quando percebe **risco de algo se perder**. Você NÃO é professor; é um parceiro
que dá um toque rápido na hora certa.

## ⚠️ GUARDRAIL — leia antes de orientar (inegociável)

1. **Só oriente quando o padrão é CLARO.** Na dúvida, responda normal e fique quieto.
2. **No máximo 1** toque de coach por mensagem.
3. **Defira às skills específicas.** Se outra skill (inventário, criar-compromisso, etc.)
   já está tratando o caso, NÃO duplique — fique quieto.
4. **Não repita** a mesma orientação pra quem já entendeu. Olhe o histórico da conversa:
   se você já ensinou isso recentemente ou a pessoa claramente já sabe, não repita.
5. **Tom:** leve, parceiro, 1-2 frases. Nunca sermão, nunca condescendente.
6. **Sempre ENSINE + OFEREÇA + CONFIRME antes de agir.** Nunca execute sobre um palpite —
   pergunte o que falta (unidade, sala, qual tarefa) e espere o "pode".

## Padrões que você vigia

### P1 — Despejo de itens/fotos de inventário sem contexto
- **Reconhecer:** a pessoa manda fotos ou lista de equipamentos/instrumentos (guitarra, caixa,
  microfone, etc.) sem dizer o que quer, e nenhuma skill de inventário assumiu o caso.
- **Fala-modelo:** "Vi que são instrumentos 👀 — quer que eu cadastre no *inventário*? Só me diz
  a unidade e a sala que eu registro um por um."
- **Quando NÃO acionar:** se a pessoa já está em modo inventário, já disse unidade/sala, ou a
  skill de inventário já está conduzindo.

### P2 — Brain-dump de demandas sem virar tarefa
- **Reconhecer:** texto ou áudio com vários itens de ação soltos ("preciso fazer X, ver Y e
  resolver Z") que não estão virando tarefa.
- **Fala-modelo:** "São 3 coisas aí — quer que eu transforme em *tarefas* pra não perder nenhuma?"
- **Quando NÃO acionar:** se já está claramente criando tarefas, ou é desabafo/conversa sem
  intenção de ação.

### P3 — Relata conclusão de passagem mas não fecha a tarefa
- **Reconhecer:** a pessoa menciona, de passagem, ter feito algo que casa com uma tarefa aberta
  dela no contexto ("ah, já liguei pro fornecedor").
- **Fala-modelo:** "Isso era a tarefa *[nome]*? Fecho ela pra você?"
- **Quando NÃO acionar:** se não há tarefa correspondente no contexto; se ela já pediu pra fechar
  (aí só feche, sem perguntar).

### P4 — Pede/pergunta algo que o sistema já faz
- **Reconhecer:** "como vejo minhas tarefas?", "dá pra ver a agenda?", ou manda algo que deveria
  ser um evento/tarefa estruturada.
- **Fala-modelo:** orienta o caminho certo, curto e direto (sem tutorial longo).
- **Quando NÃO acionar:** se a pergunta não é sobre usar o sistema.

## Resumo
Percebeu risco de trabalho se perder + padrão claro → 1 toque leve que ensina e oferece.
Não percebeu, ou já tratou → fique quieto e responda normal.
```

- [ ] **Step 2: Verificar que o arquivo existe e é não-vazio**

Run: `node -e "const s=require('fs').readFileSync('D:/la-organizer/_remote/skills/coach-usabilidade.md','utf8');console.log('LEN', s.length, 'P1', s.includes('P1'), 'P4', s.includes('P4'))"`
Esperado: `LEN <número>0+ P1 true P4 true`.

---

### Task 2: Fiar a skill no system prompt (sempre carregada)

**Files:**
- Modify: `src/prompts/system.js` (logo após o bloco da `reagir-mensagens.md`, ~linha 2666)

- [ ] **Step 1: Adicionar o carregamento cross-cutting**

Localizar o bloco existente (dentro de `if (collaborator) {`):
```js
    const reactPath = path.join(SKILLS_DIR, 'reagir-mensagens.md');
    if (fs.existsSync(reactPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(reactPath, 'utf-8');
    }
```
Inserir LOGO DEPOIS desse `}` interno (ainda dentro do `if (collaborator)`):
```js
    // Sprint 31.8 (Pilar 2) — coach-usabilidade.md SEMPRE carregada (cross-cutting):
    // TOM percebe mau uso e orienta. Guardrail forte dentro da própria skill.
    const coachPath = path.join(SKILLS_DIR, 'coach-usabilidade.md');
    if (fs.existsSync(coachPath)) {
      systemPrompt += '\n\n---\n\n' + fs.readFileSync(coachPath, 'utf-8');
    }
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check D:/la-organizer/_remote/src/prompts/system.js`
Esperado: sem saída (OK).

---

### Task 3: Smoke determinístico — a skill entra no prompt

**Files:**
- Create: `scripts/smoke-coach.js`

- [ ] **Step 1: Escrever o smoke**

```javascript
#!/usr/bin/env node
// Smoke: confirma que coach-usabilidade entra no system prompt p/ um colaborador real.
process.chdir('/opt/LA-Organizer');
const { buildSystemPrompt } = require('../src/prompts/system');
const supabase = require('../src/supabase/client');

const PHRASES = [
  'Strato Squier Azul - Regulagem',                    // P1 inventário
  'preciso ligar pro fornecedor, ver o boleto e comprar cordas', // P2 brain-dump
  'ah, já liguei pro Norton',                          // P3 conclusão de passagem
  'como vejo minhas tarefas?',                         // P4 dúvida de uso
];

(async () => {
  const { data: collab } = await supabase.from('collaborators').select('*').eq('is_active', true).limit(1).single();
  let allOk = true;
  for (const phrase of PHRASES) {
    const { systemPrompt } = await buildSystemPrompt(collab, { lastUserMessage: phrase, isAudio: false });
    const has = systemPrompt.includes('Coach de Usabilidade');
    if (!has) allOk = false;
    console.log(`${has ? 'OK ' : 'FALTOU '} | "${phrase.slice(0, 40)}"`);
  }
  console.log(allOk ? 'SMOKE PASS' : 'SMOKE FAIL');
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
```

- [ ] **Step 2: Deploy skill + system.js + smoke, e rodar o smoke**

Run:
```
scp D:/la-organizer/_remote/skills/coach-usabilidade.md tom:/opt/LA-Organizer/skills/coach-usabilidade.md
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/scripts/smoke-coach.js tom:/opt/LA-Organizer/scripts/smoke-coach.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-coach.js 2>&1 | tail -6"
```
Esperado: 4 linhas `OK` + `SMOKE PASS`.

- [ ] **Step 3: Restart pra runtime pegar o novo prompt**

Run: `ssh tom "pm2 restart tom"`
Esperado: processo `tom` online.

---

### Task 4: Checagem comportamental por exemplo (avaliação manual)

**Files:**
- (nenhum — observação de produção)

- [ ] **Step 1: Mandar 1 mensagem real de cada padrão pro TOM (via WhatsApp de teste do Alf) e observar**

Casos e comportamento esperado:
- P1 "Strato Squier Azul - Regulagem" (foto/legenda) → TOM oferece cadastrar no inventário pedindo unidade/sala.
- P2 "preciso ligar pro fornecedor, ver o boleto e comprar cordas" → TOM oferece transformar em tarefas.
- P3 "já liguei pro Norton" (havendo tarefa correspondente) → TOM pergunta se fecha a tarefa.
- P4 "como vejo minhas tarefas?" → TOM orienta o caminho, curto.
- **Controle (não-coach):** "bom dia, tudo certo?" → TOM responde normal, SEM coaching.

- [ ] **Step 2: Conferir os logs e ajustar se ficar chato**

Run: `ssh tom "pm2 logs tom --lines 40 --nostream | grep -i coach"` (se houver) e ler as respostas no WhatsApp.
Esperado: orientação só nos casos claros; silêncio no controle. Se orientar demais/repetir, apertar o guardrail na skill (estratégia "lançar e ajustar" acordada).

---

## Self-review (preenchido)

- **Cobertura do spec:** skill com guardrail + 4 padrões (T1) ✓; carregamento sempre-ativo no system.js (T2) ✓; smoke determinístico de carregamento (T3) ✓; checagem comportamental + controle anti-pregação (T4) ✓; deferência a skills específicas e confirmar-antes-de-agir embutidos no guardrail da skill ✓.
- **Placeholders:** nenhum — conteúdo da skill e do smoke completos.
- **Consistência:** o smoke procura a string "Coach de Usabilidade" que é exatamente o título (H1) do arquivo da T1. O bloco de fiação espelha o padrão `reagir-mensagens` confirmado no código (system.js ~2663).
