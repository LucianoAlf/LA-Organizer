# Design — TOM Coach de Usabilidade (Pilar 2, v1 reativo)

**Data:** 2026-05-29
**Pilar:** 2 de 4 da visão "TOM coach autoaperfeiçoável".
**Status:** aguardando revisão do usuário.

## Problema

Usuários, na correria, usam o sistema de um jeito que faz trabalho se perder: Rodrigo despeja
fotos de instrumentos sem dizer que é inventário (vira tarefa-lixo), gente faz brain-dump de
demandas no WhatsApp que nunca viram tarefa, relata de passagem que concluiu algo e nunca fecha a
tarefa (gerando cobrança vazia depois). Treinamento e explicação no dia a dia não resolvem — o cara
está na correria. O TOM precisa **perceber o risco na hora e orientar**, sem virar professor chato.

## Escopo (e não-escopo)

- **No escopo (v1):** coach REATIVO na hora — o TOM reconhece, na própria mensagem, um padrão de
  mau uso conhecido e ensina + oferece o caminho certo, confirmando antes de agir.
- **Fora do escopo:** coach PROATIVO por padrão acumulado (observar comportamento ao longo do tempo)
  — fica pra uma fase futura, precisa de infra de "dados de uso por pessoa".
- **Fora do escopo:** anti-cobrança-vazia sistêmica (Pilar 3) e autoaperfeiçoamento (Pilar 4).

## Arquitetura

Uma skill `.md` + fiação mínima. Sem serviço novo, sem banco. Reusa a infra de skills existente.

- **`skills/coach-usabilidade.md`** — conhecimento curado: os padrões (linguagem humana) + como
  reconhecer + fala-modelo + quando NÃO acionar. Única peça nova de conteúdo.
- **Carregamento:** entra no conjunto **sempre carregado** do `src/prompts/system.js` (mesmo lugar
  de SOUL/AGENTS). Pequena; coaching é transversal. Custo de token baixo.
- **Detecção = o próprio LLM.** Com o conhecimento no prompt, o TOM reconhece o padrão naturalmente.
  Sem regex/trigger novo.
- **Fronteira:** o coach é a *camada professora de fallback*. NÃO substitui skills específicas —
  **defere a elas** (se a `inventario.md` já tratou o caso, o coach fica quieto). Só preenche o gap.
- **Comportamento:** ensina + oferece + **confirma antes de agir** (não assume unidade/sala/etc).

### Guardrail (no topo da skill, inegociável)

1. Só orienta quando o padrão é **CLARO**. Na dúvida, responde normal e fica quieto.
2. **No máximo 1** orientação de coach por mensagem.
3. **Defere** às skills específicas — não duplica o que outra skill já faz.
4. **Não repete** a mesma lição pra quem já entendeu (usa o histórico da conversa pra julgar).
5. Tom: leve, parceiro, 1-2 frases. Nunca sermão.

## Os 4 padrões do v1

Cada um na skill terá: **reconhecer** / **fala-modelo** / **quando NÃO acionar**.

**P1 — Despejo de itens/fotos de inventário sem contexto** (caso Rodrigo)
- Reconhecer: fotos/lista de equipamentos/instrumentos sem dizer que é inventário, e a skill
  `inventario.md` não capturou.
- Fala-modelo: "Vi que são instrumentos — quer que eu cadastre no inventário? Só me diz a unidade/sala."
- NÃO acionar: se o usuário já está em modo inventário, ou já disse unidade/sala (a `inventario.md` cuida).

**P2 — Brain-dump de demandas sem virar tarefa**
- Reconhecer: texto/áudio com vários itens de ação ("faz isso, isso e isso") que não viraram tarefa.
- Fala-modelo: "São 3 coisas aí — quer que eu transforme em tarefas pra não perder nenhuma?"
- NÃO acionar: se já está claramente criando tarefas, ou é conversa/desabafo sem intenção de ação.

**P3 — Relata conclusão de passagem mas não fecha a tarefa**
- Reconhecer: menciona ter feito algo que casa com uma tarefa aberta dele ("já liguei pro fornecedor").
- Fala-modelo: "Isso era a tarefa *X*? Fecho ela pra você?"
- NÃO acionar: se não há tarefa correspondente no contexto, ou ele já pediu pra fechar (aí só fecha).

**P4 — Pede/pergunta algo que o sistema já faz**
- Reconhecer: "como vejo minhas tarefas?", ou manda algo que devia ser evento/tarefa estruturada.
- Fala-modelo: orienta o caminho certo, curto e direto.
- NÃO acionar: se a pergunta não é sobre usar o sistema.

## Fiação (system.js)

Adicionar `coach-usabilidade.md` ao carregamento core (junto de SOUL/AGENTS) em `src/prompts/system.js`.
A localização exata do bloco de carregamento sempre-ativo será confirmada no plano.

## Testes

Não há framework formal; "testes" = smoke determinístico + checagem por exemplo.
1. **Smoke (determinístico):** rodar `buildSystemPrompt` com mensagens de exemplo e confirmar que
   `coach-usabilidade` está presente no prompt (carregamento OK).
2. **Por exemplo (comportamental):** rodar 4 mensagens (uma por padrão) pelo provider e conferir que
   o TOM orienta+oferece no caso claro; e 2 mensagens "limpas" (sem mau uso) confirmando que ele
   NÃO vira professor (fica quieto). Avaliação manual do output.

## Riscos / mitigações

- **TOM vira chato/pregador:** guardrail forte (só quando claro, 1 por msg, não repete) + v1 com 4
  padrões. Estratégia acordada: lançar e ajustar se incomodar.
- **Conflito com skills específicas:** regra de deferência explícita no guardrail.
- **Falso reconhecimento (coaching errado):** confirma antes de agir — nunca executa sobre palpite.

## Não faz parte (adiado consciente)

- Coach proativo por padrão acumulado (precisa de store de uso por pessoa).
- Registro de "já orientei Fulano sobre X" persistente (v1 confia no histórico da conversa).
- Métrica de eficácia do coaching (quantas orientações viraram ação) — futuro, pode usar o ledger.
