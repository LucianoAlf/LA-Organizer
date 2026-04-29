# Sprint Futura — Governança de Contexto (Pessoal vs Trabalho)

> **Status:** RADAR — não implementar antes de discussão arquitetural completa.
> **Origem da discussão:** 29/04/2026, conversa Alf + Claude + openclaw após Sprint 11.4.
> **Codinome:** `Governança de Contexto` ou `Classificação Assistida de Contexto`.

---

## 🎯 Problema real

Hoje o sistema tem RLS protegendo tarefas `context='personal'` da visibilidade da liderança (coordinator/director). Isso é **correto e inegociável**.

Mas abre um **risco comportamental**:
> Colaborador pode registrar tarefa de trabalho como "pessoal" pra escapar de cobrança da liderança. O `personal` vira **cofre anti-gestão**.

Exemplos:
- ✅ Legítimo pessoal: "pagar conta de luz", "marcar dentista", "comprar remédio"
- ❌ Camuflagem: "ligar pro professor João sobre captação da Barra" salvo como `personal`

---

## ⚖️ O conflito central (duas verdades simultâneas)

| Verdade A — Privacidade | Verdade B — Governança |
|---|---|
| Líder NÃO pode ver: contas, médico, vida íntima, lembretes pessoais sensíveis | Trabalho NÃO pode sumir da gestão como `personal` |
| Privacidade é direito | Visibilidade do trabalho é parte do contrato |
| RLS atual é certa | RLS atual permite a brecha |

**Não dá pra resolver com "confiança humana"** ("gente, usem certo"). Precisa de mecanismo.

---

## 🧠 Tese do openclaw (compro inteira)

**Não é só campo `personal/work` livre — precisa classificação inteligente com fricção seletiva.**

### 3 níveis de reação proporcional

| Nível | Quando | Comportamento |
|---|---|---|
| **1. Sugestão leve** | Conteúdo ambíguo / sinais fracos de trabalho | "Isso parece mais tarefa de trabalho. Quer registrar em trabalho?" |
| **2. Confirmação obrigatória** | Sinais fortes de trabalho (nome de colaborador, unidade, projeto) | "Isso parece claramente ligado à LA Music. Confirma manter como pessoal?" |
| **3. Bloqueio / flag** | Casos óbvios + reincidência | "Não vou registrar como pessoal sem justificativa explícita." |

**Começar por Nível 1+2.** Nível 3 só depois de medir falso positivo. Não virar polícia automática.

---

## 🏗️ Arquitetura proposta (4 camadas)

### A. Skill / prompt
- Skill `checklist-tarefas` aprende a:
  - Inferir `context` antes de aceitar a escolha do user
  - Desconfiar de mismatch
  - Orientar reclassificação
- Sem mencionar "policy" / "governança" pro user — linguagem natural.

### B. Engine — heurística complementar (não confiar só no LLM)
Detecção determinística por sinais:
- **Lista de termos LA**: nomes de colaboradores ativos, nomes de projetos ativos, unidades (Barra/Recreio/Campo Grande), termos operacionais (NF, captação, aluno, professor, lead, comercial, marketing, produção, contrato, financeiro, coordenação)
- **Match score**: quantos termos batem → confidence
- **Resultado**: emite hint pro LLM que aciona Nível 1/2/3

### C. Banco — schema novo
```sql
ALTER TABLE tasks ADD COLUMN context_inferred TEXT;        -- 'personal' | 'work' | null
ALTER TABLE tasks ADD COLUMN context_user_selected TEXT;   -- o que o user pediu
ALTER TABLE tasks ADD COLUMN context_confidence NUMERIC;   -- 0..1 da inferência
ALTER TABLE tasks ADD COLUMN context_mismatch_flag BOOLEAN DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN context_override_reason TEXT; -- justificativa do user (Fase 2+)
```
- `context` (existente) continua sendo o efetivo — RLS opera nele
- Os novos campos são telemetria + governança

### D. PWA / gestão
- **Líder NÃO vê conteúdo pessoal suspeito** (anti-falso-positivo)
- Pode ver **métricas agregadas**: "X% das tasks pessoais do colaborador Y têm flag de mismatch"
- Confronto sempre na origem (skill/engine), nunca exposto ao líder

---

## 🛡️ Política de falso positivo

Caso cinzento:
> "ligar pra Anne" — pode ser pessoal (esposa) ou trabalho (Anne Susan, colaboradora)

**Nunca virar polícia.** Sequência:
1. Engine detecta ambiguidade (nome próprio que existe na tabela `collaborators`)
2. Sugere via Nível 1, sem bloquear
3. User decide
4. Se user mantém pessoal e não há outros sinais fortes → respeita

---

## 🚦 Roadmap em fases

### Fase 1 — Assistida (MVP)
- Heurística de inferência (skill + engine)
- Sugestão Nível 1 + Nível 2
- Logs de mismatch (sem ação punitiva)
- Schema dos 5 campos novos

### Fase 2 — Governança
- Score de reincidência por colaborador
- Nível 3 (bloqueio em casos óbvios + reincidência)
- `context_override_reason` obrigatório quando user mantém pessoal contra Nível 2
- Métricas operacionais

### Fase 3 — Analytics
- Dashboard agregado pra liderança (sem conteúdo)
- "X% das tasks pessoais com sinal de trabalho"
- Padrões temporais (dia da semana, projeto, função)
- Sem expor tasks individuais — só agregado

---

## ❌ Vetos (o que NÃO fazer)

- ❌ Líder ver conteúdo pessoal suspeito de cara
- ❌ Confiar só no prompt do LLM (sempre tem fallback determinístico)
- ❌ Resolver com onboarding text-only ("usem certo")
- ❌ Bloquear sem medir falso positivo
- ❌ Vazar `description`/`title` em log/métrica visível à liderança

---

## ✅ Próximo passo (quando atacar)

Antes de codar:
1. Discussão de schema (5 campos certos? 3? 7?)
2. Lista canônica de termos LA pra heurística determinística
3. UX dos prompts Nível 1/2 (palavras exatas)
4. Política de falso positivo formalizada
5. Decisão de cultura: a empresa quer Nível 3 algum dia?

**Não atacar antes da decisão acima.** Codar errado aqui pode quebrar privacidade ou criar atrito legítimo.

---

## 📚 Referências da discussão

- Alf trouxe o problema com exemplo do "x-videos" (privacidade legítima) vs "ligar pro professor sobre captação" (camuflagem)
- openclaw cravou nome + 3 níveis + 4 camadas + 3 fases + vetos
- Claude documentou aqui pra próxima sessão ter contexto completo

> **Lembrar:** isso é **integridade do produto**, não detalhe. Sem isso, o `personal` vira cofre anti-gestão e a confiança da liderança no app cai.
