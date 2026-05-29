# Enxugar o system prompt (Fase 1: conteúdo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Reduzir a latência cortando ~28KB de gordura das 3 skills always-on mais pesadas, sem tocar em markers/regras nem em quando carregam.

**Architecture:** Edição só de arquivos `.md` em `skills/`. `system.js` intacto. Validação por diff revisado + smoke de âncoras + monitor de latência. 1 skill por task; diff mostrado ANTES do deploy de cada uma.

**Tech Stack:** Markdown, smoke Node, SCP pro VPS. Deploy por skill.

**Notas:** Prompt é lido em runtime; restart no fim garante. Auto-deploy hook commita `_remote/` no fim do turno. Baseline atual: prompt ~100KB, mediana ~26s (monitor `provider_health`).

---

### Task 1: Smoke de âncoras

**Files:** Create `scripts/smoke-prompt-trim.js`

- [ ] **Step 1:** Escrever o smoke que lê cada skill cortada e confirma que as âncoras essenciais continuam presentes. Âncoras por skill são definidas após ler o arquivo original (Task 2 Step 1, etc.) — o smoke checa substrings exatas dos markers/ações/enums/regras que NÃO podem sumir. Conteúdo final do smoke é montado ao longo das tasks (cada task adiciona suas âncoras).
- [ ] **Step 2:** Rodar `node scripts/smoke-prompt-trim.js` localmente → todas âncoras `OK` (com os arquivos ainda originais, deve passar 100%, provando que as âncoras existem antes do corte).

---

### Task 2: criar-compromisso (30.6KB → ~16KB)

**Files:** Modify `skills/criar-compromisso.md`

- [ ] **Step 1:** Ler o arquivo inteiro. Listar âncoras sagradas (nome do marker de tarefa/evento, ações `complete/reschedule/create/cancel/delegate`, regra 1/2/3 de desambiguação, `bypass_integrity`, vetos) e registrá-las no smoke (Task 1).
- [ ] **Step 2:** Cortar SÓ gordura (comentários históricos "Sprint X/bug DD/MM", repetição, prosa redundante, exemplos duplicados). Manter todas as âncoras.
- [ ] **Step 3:** Rodar smoke → âncoras de criar-compromisso `OK`. Conferir `wc -c` ≈ 16KB.
- [ ] **Step 4:** Mostrar resumo do diff ao usuário. Deploy só após o OK: `scp skills/criar-compromisso.md tom:/opt/LA-Organizer/skills/`.

---

### Task 3: priorizacao-inteligente (21.5KB → ~12KB)

**Files:** Modify `skills/priorizacao-inteligente.md`

- [ ] **Step 1:** Ler inteiro. Âncoras: enum `now/task/call/meeting/delegate/project`, a lógica de decisão (5min/Eisenhower) e como reflete no `action_type`. Registrar no smoke.
- [ ] **Step 2:** Cortar gordura, manter âncoras.
- [ ] **Step 3:** Smoke → `OK`. `wc -c` ≈ 12KB.
- [ ] **Step 4:** Mostrar diff → OK → `scp`.

---

### Task 4: pedagogico (10.8KB → ~6KB)

**Files:** Modify `skills/pedagogico.md`

- [ ] **Step 1:** Ler inteiro. Âncoras: roteamento por papel pedagógico + qualquer marker/regra de decisão. Registrar no smoke.
- [ ] **Step 2:** Cortar gordura, manter âncoras.
- [ ] **Step 3:** Smoke → `OK`. `wc -c` ≈ 6KB.
- [ ] **Step 4:** Mostrar diff → OK → `scp`.

---

### Task 5: Restart + verificação

- [ ] **Step 1:** `ssh tom "pm2 restart tom"` → online.
- [ ] **Step 2:** Medir o novo tamanho do prompt: rodar 1 mensagem de teste OU `node --env-file=.env -e` que monta `buildSystemPrompt` p/ um colab e loga `systemPrompt.length`. Esperado: ~72KB (de ~100KB).
- [ ] **Step 3:** Observar o monitor `provider_health` nas próximas 24h (relatório 07:00) — mediana deve cair; markers rejeitados não devem subir.

---

## Self-review
- **Cobertura do spec:** 3 skills na ordem (T2-T4) ✓; smoke de âncoras (T1) ✓; diff antes de cada deploy (T2-T4 Step4) ✓; restart + medição + observação (T5) ✓.
- **Nota:** o conteúdo exato cortado não está no plano por natureza (depende de ler cada arquivo) — a regra sagrado×gordura + as âncoras no smoke garantem a segurança. Diff revisado pelo usuário é o gate final por skill.
