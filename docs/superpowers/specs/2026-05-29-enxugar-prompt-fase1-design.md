# Design — Enxugar o system prompt (Fase 1: conteúdo das skills always-on)

**Data:** 2026-05-29
**Status:** aprovado pelo usuário.
**Escopo:** conteúdo (texto das skills). NÃO mexe em QUANDO as skills carregam.

## Problema

Latência mediana do TOM ~26s (P95 119s) — medido pelo monitor `provider_health`. A causa é o
system prompt de ~100KB: o engine empilha skills "auxiliares" pesadas em quase toda mensagem,
independente da intenção. Custo fixo por mensagem (medido):

| Bloco | Tamanho | Quando |
|---|---|---|
| SOUL + AGENTS | 10.7KB | sempre |
| criar-compromisso | 30.6KB | sempre (exceto se for a primária) |
| priorizacao-inteligente | 21.5KB | quando primária é de criação |
| pedagogico | 10.8KB | sempre (exceto se primária) |
| integridade-agenda | 5.7KB | sempre |
| coach-usabilidade | 4.5KB | sempre |
| reagir-mensagens | 3.8KB | sempre |

As 3 maiores (criar-compromisso, priorizacao, pedagogico = 63KB) entram até num "bom dia".
Latência do LLM escala com tokens de entrada → cortar KB do prompt reduz o tempo proporcionalmente.

## Escopo (e não-escopo)

- **No escopo:** enxugar o TEXTO de 3 skills always-on, cortando só gordura:
  - `criar-compromisso` 30.6KB → ~16KB
  - `priorizacao-inteligente` 21.5KB → ~12KB
  - `pedagogico` 10.8KB → ~6KB
  - Total: ~63KB → ~34KB (~28KB a menos por mensagem, ~−28% do prompt).
- **Fora do escopo:**
  - Mudar QUANDO as skills carregam (gating/dispatch) — fase futura, decidida com o dado do monitor.
  - Enxugar skills condicionais (checklist-tarefas, gerencia, etc.) — só carregam quando usadas.
  - Reduzir o contexto dinâmico (histórico 7 dias, orgChart) — fase futura.

## Regra de corte (sagrado × gordura)

- **NUNCA cortar (sagrado):** formatos de marker, schemas/nomes de campo, exemplos canônicos de
  sintaxe de marker, regras de decisão, vetos, guardrails, blocos "quando NÃO acionar", a regra do
  1/2/3 (dup multi-turno) e `bypass_integrity`.
- **Cortar (gordura):** comentários históricos ("Sprint X, bug 29/04, caso real…"), repetição da
  mesma regra em lugares diferentes, prosa redundante/explicativa, exemplos duplicados (mantém 1
  canônico por padrão).

## Arquitetura

Trabalho puramente em arquivos `.md` em `skills/`. Sem mudança em `system.js` (o `loadSkill` e o
`pickSkill` ficam idênticos — só o conteúdo dos arquivos encolhe). Deploy via SCP. Sem restart
necessário pro prompt (lido em runtime), mas faço restart pra garantir.

## Validação (diff revisado + smoke + radar)

Por skill, na ordem (1 por task):
1. **Diff revisado:** mostro ao usuário um resumo do que saiu (só gordura; regras intactas) ANTES
   do deploy de cada skill.
2. **Smoke de âncoras:** `scripts/smoke-prompt-trim.js` confirma que cada skill cortada MANTÉM suas
   âncoras essenciais no arquivo:
   - `criar-compromisso`: nome do marker de tarefa/evento, ações `complete/reschedule/create/cancel/delegate`,
     a regra de desambiguação 1/2/3, `bypass_integrity`.
   - `priorizacao-inteligente`: o enum `now/task/call/meeting/delegate/project`.
   - `pedagogico`: roteamento por papel pedagógico (âncora a confirmar lendo o arquivo).
3. **Pós-deploy:** o monitor `provider_health` (24h) mede a mediana antes/depois; o radar de
   known-issues + `marker_logs` pegam regressão de comportamento (markers rejeitados).

## Métrica de sucesso

Prompt cai de ~100KB → ~72KB. Mediana de latência medida no monitor `provider_health` antes/depois.
Meta: queda perceptível da mediana, sem aumento de markers rejeitados.

## Riscos / mitigações

- **Cortar uma regra que o LLM precisava:** mitigado pela regra "sagrado × gordura" + diff revisado
  antes de cada deploy + smoke de âncoras + radar pós-deploy.
- **Regressão de comportamento difícil de notar:** monitor de latência + marker_logs (markers
  rejeitados) + a pessoa real usando; reversível (git history do `_remote`).

## Não faz parte (adiado consciente)

- Gating/carregamento condicional das auxiliares (Fase 2, se a Fase 1 não bastar).
- Enxugar contexto dinâmico (histórico, orgChart).
- Enxugar skills condicionais.
