# Skill de Ajuda + Briefing Pessoal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a skill `ajuda.md` que guia o usuário pelo que o TOM pode fazer (menu conversacional por cargo), adicionar detecção de trigger em `system.js`, e ativar o briefing pessoal automático no dispatcher.

**Architecture:** Skill carregada por `system.js` via bloco de detecção por keywords. Conversa multi-turn: TOM apresenta 3 áreas → usuário escolhe → TOM aprofunda com exemplos reais. Dispatcher recebe flag para rodar `briefing_pessoal` automaticamente (hoje desativado por Sprint 11.1 — verificar e ativar corretamente).

**Tech Stack:** Markdown (skill), Node.js (system.js, dispatcher.js). Sem mudanças no banco ou PWA.

---

## Mapa de arquivos

| Arquivo | Ação |
|---|---|
| `skills/ajuda.md` | Criar — guia conversacional completo |
| `src/prompts/system.js` | Modificar — detectar triggers de ajuda |
| `src/rituals/dispatcher.js` | Verificar/Modificar — ativar briefing pessoal automático |

---

## Task 1: Criar `skills/ajuda.md`

**Files:**
- Create: `skills/ajuda.md`

- [ ] **Step 1: Criar a skill completa**

Crie `D:\la-organizer\_remote\skills\ajuda.md`:

```markdown
# SKILL: AJUDA — O que o TOM pode fazer

## Quando esta skill ativa

Usuário pergunta sobre funcionalidades, comandos ou como usar o sistema:
- "como você funciona?", "o que você pode fazer?", "o que você faz?"
- "comandos", "funcionalidades", "o que tem aqui", "menu"
- "como te uso", "me explica", "como usar você"
- "me ajuda" ou "ajuda" isolados (não quando seguidos de ação: "me ajuda a criar tarefa X")

---

## Comportamento: conversa multi-turn

### PASSO 1 — Abertura (SEMPRE enviar isto primeiro)

Responde com as 3 áreas. Não lista tudo de uma vez — aguarda o usuário escolher:

```
👽 Posso te ajudar de várias formas, [nome]! Tenho três áreas:

📅 *Rituais* — briefing, fechamento, planejamento semanal
✅ *Trabalho* — tarefas, projetos, checklists
💪 *Pessoal* — hábitos, agenda, organização

Quer saber mais sobre qual?
```

---

### PASSO 2A — Se usuário responder "rituais" (ou "ritual", "briefing", "planejamento", "rotina")

```
📅 *Meus rituais diários:*

☀️ *Briefing matinal* — toda manhã te mando resumo do dia (tarefas, compromissos)
🌙 *Fechamento* — no fim do dia, vejo o que ficou pendente contigo
📊 *Planejamento semanal* — uma vez por semana a gente para e planeja juntos
🔍 *Retrospectiva* — reviso o que aconteceu na semana anterior

Horários configuráveis nas Configurações do app. Quer ajustar algum?
```

Frase de coaching (escolha a mais adequada ao contexto):
- "Consistência nos rituais faz toda diferença. Que tal começar com o briefing amanhã? ☀️"
- "Quem olha pro dia antes de começar chega mais longe. Confia 💪"

---

### PASSO 2B — Se usuário responder "trabalho" (ou "tarefas", "projetos", "profissional")

Use o cargo (function_title) do usuário para personalizar. Veja o contexto injetado — campo **Pessoa** mostra o cargo. Escolha o bloco correspondente:

**Para Hunter ou Farmer:**
```
✅ *No trabalho posso te ajudar com:*

• "cria tarefa X pra sexta" → registro e te cobro no prazo
• "o que tenho hoje?" → resumo do dia
• "o que ficou pendente?" → pendências em aberto
• "cria projeto Y" → projeto com checkpoints
• "como tá meu pipeline?" → follow-ups e pendências comerciais

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Para Professor ou Assistente Pedagógico:**
```
✅ *No trabalho posso te ajudar com:*

• "o que tenho hoje?" → agenda de aulas + tarefas
• "cria tarefa X" → registro com prazo e cobrança
• "o que tá atrasado?" → pendências do dia
• "abre checklist de abertura" → checklists operacionais
• "como foi minha semana?" → retrospectiva pedagógica

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Para Gerente, Coordenador ou Diretor:**
```
✅ *No trabalho posso te ajudar com:*

• "o que tenho hoje?" → agenda + tarefas + equipe
• "como tá o time?" → resumo da equipe
• "cria projeto X" → projeto com 5W2H e checkpoints
• "aprova projeto Y" → fluxo de aprovação
• "o que tá atrasado?" → pendências da equipe

Pede do jeito que você falar — entendo linguagem natural 😉
```

**Para demais cargos (Financeiro, RH, ou não mapeado):**
```
✅ *No trabalho posso te ajudar com:*

• "cria tarefa X pra sexta" → registro e te cobro no prazo
• "o que tenho hoje?" → resumo do dia
• "o que ficou pendente?" → pendências em aberto
• "cria projeto Y" → projeto com checkpoints
• "como foi minha semana?" → retrospectiva semanal

Pede do jeito que você falar — entendo linguagem natural 😉
```

Frase de coaching (escolha a mais adequada):
- "Quanto mais você me usa, mais fácil fica organizar a cabeça. Bora? 💪"
- "Uma mensagem por dia já faz diferença. Testa hoje 🎯"

---

### PASSO 2C — Se usuário responder "pessoal" (ou "hábito", "vida pessoal", "pessoal")

```
💪 *Na vida pessoal posso te ajudar com:*

• "quero criar o hábito de X" → registro e acompanhamento diário
• "me lembra de Y amanhã às 10h" → lembrete pessoal
• "como foram meus hábitos essa semana?" → retrospectiva pessoal
• "anota que prefiro reuniões às 15h" → memória pessoal
• "o que tenho no pessoal hoje?" → agenda pessoal

O que é pessoal fica só entre a gente 🤐
```

Frase de coaching (escolha a mais adequada):
- "Não precisa ser perfeito. Começa pequeno e a gente vai ajustando juntos 🚀"
- "Tô aqui todo dia, [nome]. Pode contar comigo 👽"

---

## Regras desta skill

1. **Máximo 4 linhas por mensagem** (regra geral do TOM — nunca quebrar)
2. **Tom informal, direto** — sem corporativês, sem listas de 20 itens
3. **Nunca listar tudo de uma vez** — espera o usuário escolher a área
4. **Terminar com pergunta ou coaching** — não deixa a conversa morta
5. **Cargo > generalização** — se sabe o cargo, usa o bloco específico
6. **"Me ajuda a criar tarefa X" NÃO é pedido de ajuda** — é criação de tarefa, não ativar esta skill
```

- [ ] **Step 2: Verificar que o arquivo foi criado**

```bash
ls "D:\la-organizer\_remote\skills\" | grep ajuda
```

Esperado: `ajuda.md` listado.

---

## Task 2: Adicionar trigger de ajuda em `src/prompts/system.js`

**Files:**
- Modify: `src/prompts/system.js`

**Contexto:** O arquivo tem ~700 linhas. A detecção de skills por keyword fica na função que monta o contexto (em torno da linha 396, onde `aprovar-projeto` é detectado). Skills são carregadas com `loadSkill('nome-sem-extensao')` — a função já adiciona `.md`.

- [ ] **Step 1: Ler o trecho ao redor da linha 396**

Leia `D:\la-organizer\_remote\src\prompts\system.js` linha 380 a 420 para localizar exatamente onde adicionar o novo bloco.

- [ ] **Step 2: Adicionar detecção da skill de ajuda**

**Logo antes** do bloco do `aprovar-projeto` (linha ~396), adicione:

```javascript
  // Trigger: skill de ajuda — usuário pergunta como o sistema funciona
  const lmLower = (lastUserMessage || '').toLowerCase().trim();
  const AJUDA_TRIGGERS = [
    'como você funciona', 'o que você pode fazer', 'o que você faz',
    'comandos', 'funcionalidades', 'o que tem aqui', 'como te uso',
    'como usar você', 'me explica', 'menu',
  ];
  const isHelpAlone = /^(me ajuda|ajuda)[?!.]*$/.test(lmLower);
  // lmLower.length < 80: evita ativar em "me ajuda a criar tarefa de marketing para..."
  if ((AJUDA_TRIGGERS.some(t => lmLower.includes(t)) || isHelpAlone) && lmLower.length < 80) {
    return { name: 'ajuda', body: loadSkill('ajuda') };
  }
```

> **Nota:** `loadSkill('ajuda')` → lê `skills/ajuda.md` (a função appenda `.md` automaticamente).
> Confirmado no código: `const p = path.join(SKILLS_DIR, name + '.md')`.

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check D:\la-organizer\_remote\src\prompts\system.js
```

Esperado: sem erros de sintaxe.

---

## Task 3: Ativar briefing pessoal em `src/rituals/dispatcher.js`

**Files:**
- Modify: `src/rituals/dispatcher.js`

**Contexto (Sprint 11.1):** Em Sprint 11.1, o briefing foi UNIFICADO — work + pessoal chegam na mesma mensagem no horário `briefing_time`. O `personal_briefing` separado foi desativado. Antes de qualquer mudança, verificar se a seção pessoal está chegando corretamente no briefing unificado.

- [ ] **Step 1: Verificar o briefing atual**

Leia `D:\la-organizer\_remote\src\rituals\dispatcher.js` linhas 1480–1520 para ver o comportamento atual do briefing unificado e confirmar se a seção pessoal está incluída.

- [ ] **Step 2: Confirmar comportamento com força manual**

No VPS, teste o briefing pessoal manual para confirmar que funciona:

```bash
ssh tom "cd /opt/LA-Organizer && node src/rituals/dispatcher.js --force=briefing_pessoal --dry-run 2>&1 | head -30"
```

Esperado: logs mostrando colaboradores que receberiam o briefing pessoal.

- [ ] **Step 3: Decisão baseada no que foi encontrado**

**Cenário A:** O briefing unificado já inclui seção pessoal → nenhuma mudança no dispatcher necessária. Documentar como "verificado, funcionando".

**Cenário B:** A seção pessoal não está chegando corretamente → localizar onde a supressão acontece e remover. O código a procurar:

```javascript
// Procurar algo assim:
if (ritual === 'personal_briefing' || ritual === 'briefing_pessoal') {
  // skip ou continue
}
// OU:
// Sprint 11.1: personal_briefing DESATIVADO
```

Se encontrar, remover a supressão OU adicionar condição para rodar no `personal_briefing_time` separado.

- [ ] **Step 4: Verificar sintaxe após mudança (se houve)**

```bash
node --check D:\la-organizer\_remote\src\rituals\dispatcher.js
```

Esperado: sem erros.

---

## Task 4: Deploy no VPS (TOM)

Os arquivos `src/` e `skills/` são servidos pelo VPS — precisam de SCP imediato, não esperam o Vercel.

- [ ] **Step 1: Verificar conexão com o VPS**

```bash
ssh tom "echo 'VPS OK'"
```

Esperado: `VPS OK`.

- [ ] **Step 2: SCP dos arquivos modificados**

```bash
# Skill de ajuda (novo)
scp D:/la-organizer/_remote/skills/ajuda.md tom:/opt/LA-Organizer/skills/ajuda.md

# System.js (modificado — trigger de ajuda)
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js

# Dispatcher (se foi modificado na Task 3)
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js

# Skill de onboarding (melhorada na Task 5 do Plano 1, se aplicável)
scp D:/la-organizer/_remote/skills/onboarding.md tom:/opt/LA-Organizer/skills/onboarding.md
```

- [ ] **Step 3: Reiniciar TOM**

```bash
ssh tom "pm2 restart tom --no-color 2>&1 | tail -3"
```

Esperado: linha mostrando TOM `online`.

- [ ] **Step 4: Verificar logs após restart**

```bash
ssh tom "pm2 logs tom --lines 20 --nostream"
```

Esperado: logs normais de inicialização, sem erros de sintaxe ou módulo não encontrado.

- [ ] **Step 5: Teste manual da skill de ajuda**

Manda "como você funciona?" para o TOM no WhatsApp e confirma que responde com as 3 áreas (rituais, trabalho, pessoal).

- [ ] **Step 6: Auto-deploy para commitar os arquivos**

```powershell
& "D:\la-organizer\_remote\scripts\auto-deploy.ps1"
git -C "C:\la-deploy-work" log --oneline -1
```

---

## Self-review checklist (para o implementador)

- [ ] `loadSkill('ajuda')` (sem `.md`) — a função adiciona `.md` automaticamente
- [ ] Trigger `lmLower.length < 80` evita falso positivo em "me ajuda a criar tarefa de..."
- [ ] Skill tem bloco separado por cargo (Hunter/Farmer, Professor/APed, Gerente/Coord/Diretor, demais)
- [ ] Dispatcher: verificado se briefing pessoal já chega no unificado (Cenário A) ou corrigido (Cenário B)
- [ ] SCP feito para todos os arquivos modificados antes do pm2 restart
- [ ] TOM responde "como você funciona?" com menu das 3 áreas
- [ ] `node --check` passa para system.js e dispatcher.js
