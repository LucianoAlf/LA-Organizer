# Proposta de fixes — Auditoria TOM 25/06 (para revisão cruzada)

> Documento auto-contido para o chat revisor avaliar contrapontos **antes** de codar.
> Objetivo: confirmar causa-raiz, validar o patch e caçar regressões que eu possa não estar enxergando.

---

## Contexto mínimo (para quem não acompanhou)

TOM é um agente de WhatsApp (Node/CommonJS). Quando ele afirma que persistiu algo ("✅ Criado!", "Anotado!") mas o marker correspondente falhou, temos uma **confabulação** (mente pro usuário). Há duas redes contra isso:

1. **`sanitizeOptimisticConfirm(text, 'failed'|'partial')`** (`src/lib/optimistic-confirm.js`): roda **dentro de cada handler de marker** no ramo de falha — remove as linhas que afirmam conclusão.
2. **Chokepoint Camada 1 `enforceNoMarkerHonesty`** (engine ~11244): rede global no fim do turno; se a fala afirma conclusão e **nada** persistiu, rebaixa pra honesta.

Ontem (24/06) subiram: `CONFAB-CHOKEPOINT-SCOPE` (o chokepoint estava morto por ReferenceError; voltou a rodar 24/06 11:16 UTC) e `DUP-QUOTE-SCAFFOLD`. A auditoria de hoje confirma que ambos funcionam (Dai teve `CHOKEPOINT redirected` nos logs; Juliana foi suprimida corretamente).

---

## Achado 1 — `NOTE_ACTION` confabula na falha  ✅ fix proposto

### Evidência (Luciano/Alf, 24/06 21:49 BRT)
Alf pediu "guarda o fechamento financeiro nas anotações". O marker foi rejeitado (`NOTE_ACTION rejected: schema_invalid`) → **nada salvou**. Mas a resposta saiu:

> "Claro, Alf! Salvando nas suas anotações.
> **Anotado!** Agora me conta o que foi cada um...
> _⚠️ não consegui salvar a anotação — me manda de novo?_"

→ "Anotado!" + "não consegui salvar" na mesma mensagem.

### Causa-raiz
O handler do `NOTE_ACTION` (`src/engine.js`) monta a resposta de falha a partir de `parsedNote.cleanText` **sem** passar por `sanitizeOptimisticConfirm`. Os handlers de **TASK** (linhas 9458/9478) e **EVENT** (9692/9705) **chamam** o sanitizador no ramo de falha — o NOTE ficou de fora do padrão, em **dois** pontos:

- **Linha ~9759** (marker malformado / `schema_invalid`)
- **Linha ~9808** (`res.ok === false` na execução)

Por que o chokepoint global não pegou de rede? Porque a própria nota de erro termina em "?" ("me manda de novo?") e o gate `infoGathering` (`hasTrailingQuestion`) faz o chokepoint dar no-op. O fix no NOTE resolve **sem** tocar nesse gate sensível.

### Patch proposto (espelha TASK/EVENT — 2 linhas)
```js
// ~9759 (malformado):
- const baseN = (parsedNote.cleanText || '').trim();
+ const baseN = sanitizeOptimisticConfirm((parsedNote.cleanText || '').trim(), 'failed');

// ~9808 (res.ok === false): adicionar 1 linha antes de anexar a nota
  let baseN = parsedNote.cleanText || '';
  if (!res.ok) {
+   baseN = sanitizeOptimisticConfirm(baseN, 'failed');
    baseN = (baseN ? baseN + '\n\n' : '') + (res.error === 'note_not_found'
      ? '_não achei essa anotação. Me diz o título que eu procuro._'
      : '_⚠️ não consegui salvar a anotação agora — tenta de novo?_');
  }
```

### Análise de risco / regressão
- **Risco baixo.** É exatamente o que 6 outros pontos (TASK/EVENT) já fazem.
- `sanitizeOptimisticConfirm(_, 'failed')` só remove **linhas** que afirmam conclusão (`Anotado!`, `✅ Criado`, totalizador+verbo). Não toca texto neutro.
- Borda a vigiar: se o `cleanText` tiver uma frase otimista sobre **outra** coisa (não a nota), seria removida junto. Improvável aqui (o cleanText é a fala sobre a própria anotação), mas é o ponto que peço ao revisor para stress-testar.

### Plano de teste
- Unit (já existe cobertura de `sanitizeOptimisticConfirm`): `"Anotado! Agora me conta..."` + `'failed'` → remove a linha.
- E2E/produção: reenviar o cenário do Alf (texto longo → NOTE falha) e confirmar no log que a resposta **não** contém "Anotado!".

### Perguntas pro revisor
1. Há algum caminho de `NOTE_ACTION` de sucesso parcial (ex.: share com `unresolved`) onde sanitizar `'failed'` apagaria uma confirmação **legítima**?
2. Faz sentido tratar a raiz do `schema_invalid` (por que o marker do NOTE quebrou com texto financeiro grande?) como item separado, ou está fora de escopo?

---

## Achado 2 — "hoje" vs "amanhã" na fala  ⚠️ NÃO é bug de código

### Evidência (Luciano/Alf, 24/06 21:48 BRT)
Alf (por áudio): "me lembra **amanhã** 10h". TOM confirmou certo ("amanhã às 10h"), e ao criar disse "Te lembro às 10h de **hoje**". A tarefa foi gravada **corretamente**: `due_date = 2026-06-25`, `remind_at = 25/06 10:00 BRT`. O lembrete vai disparar na hora certa.

### Causa-raiz (revisei minha hipótese inicial)
**Não é `localYmd`/fuso no código.** O system prompt (`buildContext`, system.js ~275-345) usa `Intl.DateTimeFormat` com timezone explícito e injeta tudo certo às 21:48 BRT:
- `Data/hora agora (BRT): 2026-06-24 21:48`
- `Amanhã (BRT): 2026-06-25`
- Tabela de datas com `(HOJE)`=24/06, `(amanhã)`=25/06
- "REGRA DE OURO": *"NUNCA recalcule... não fala 'amanhã', não fala 'hoje', use o rótulo"*

Ou seja: contexto correto, gravação correta. **Foi o LLM que verbalizou "hoje" ignorando o próprio contexto** — erro de geração, não de código. O guard `AMANHA-POS-MEIA-NOITE` (system.js ~296) só cobre madrugada (<5h BRT); este caso foi 21:48.

### Opções
- **(A) Não mexer.** Impacto baixo: dado certo, lembrete dispara certo; só a fala confunde, e só na borda noturna. Custo de mexer > ganho.
- **(B) Reforço mínimo de prompt** focado em "hoje/amanhã" — porém frágil (o prompt já tem REGRA DE OURO explícita e o LLM furou) e é território de comportamento do TOM (sensível).
- **(C) Rede determinística pós-resposta**: comparar a data verbalizada com a data do marker e corrigir "hoje/amanhã". Mais robusto, porém **complexo e arriscado** (parsing de linguagem natural de datas na fala) — provavelmente desproporcional ao impacto.

### Recomendação
**(A) não mexer agora**, registrar como known-issue de baixa severidade e observar reincidência. Se reincidir fora da borda noturna, reconsiderar (B/C).

### Pergunta pro revisor
O prompt já é forte ("não fala hoje/amanhã, use o rótulo") e ainda assim o LLM furou. Você vê algum reforço de prompt de **alta** eficácia e **baixo** risco, ou concorda em só observar?

---

## Itens triados como NÃO-fix (resumo, para o revisor sanity-check)
- **Dai (confab tarefa):** o chokepoint **funcionou** (log `CHOKEPOINT redirected confab:unknown`). Resíduo "te cobro depois" durante fallback Codex; a tarefa já existia e foi reagendada 3min depois. Pegar esse resíduo exigiria mexer no gate de completion = alto risco de rebaixar frases legítimas. **Não mexer.**
- **Matheus ×2 / Juliana ×2:** já corrigidos ontem (`FIN-DERROTISMO-NOMARKER-NOCLOSE` / `DUP-QUOTE-SCAFFOLD`); a feature de precisão suprimiu corretamente.
- **Fefê / Jhonatan (TASK_UPDATE all_failed):** guard de tarefa futura pedindo confirmação (`FECHAMENTO-COBRA-AMANHA`). Funcionando.
- **FINANCE defeatism/fabricated (Alf):** guards do financeiro funcionando.
- **Quintela (cobrança antecipada):** preferência do usuário (snooze por tarefa, spec já mapeada), não bug.
- **2 profiles sem refresh / 5× Realtime instável:** benigno (inativos / reconexão transitória).
