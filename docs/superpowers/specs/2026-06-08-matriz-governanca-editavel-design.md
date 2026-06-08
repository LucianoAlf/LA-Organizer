# Matriz de governança editável (híbrido) — Design

**Data:** 2026-06-08
**Autor:** TOM/Claude + Alf (CEO)
**Status:** aprovado o design conceitual; aguardando review da spec antes do plano.

## Objetivo (1 frase)
Permitir que o CEO monte a matriz de liderança da empresa (quem reporta a quem) direto na **Gestão equipe**, sem mexer em código — mantendo as regras automáticas de roteamento que já existem e somando a elas um override manual N:N, com preview ao vivo.

## Contexto / estado atual (verificado)
- A edição de colaborador **já persiste no banco**: `GestaoEquipeDetalhe.tsx` (`saveMutation`, linhas 105-117) faz `update` real em `collaborators` com `{full_name, phone, email, function_title, role, unit, is_active}`. **Não** edita `function_role` nem o vínculo de liderança.
- O "quem lidera quem" é resolvido por **regras** sobre campos do banco, em DOIS arquivos espelhados (fonte única de verdade duplicada por plataforma):
  - PWA: `web/src/lib/team-routing.ts` (`resolveLeadersOf`, `resolveLeaderIdsOf`, `membersOf`).
  - TOM: `src/services/leader-routing.js` (idem), consumido em `src/rituals/dispatcher.js`.
  - Regras hoje: pedagógico → AMBOS coords pedagógicos; marketing → manager de marketing; lotado em unidade → manager da unidade; `supervisor_id` explícito (não-CEO) → somado; órfão/auto-líder → CEO.
- **`supervisor_id` já existe e já é consumido** (vínculo manual 1:1 aditivo). Valores não-CEO atuais a preservar: **Dai→Juliana, Leo→Krissya, Matheus Felipe→Quintela**.
- `function_role` em uso: `pedagogico` (9), `farmer` (7), `marketing` (2), `ops_tecnicas` (1=Rafinha), `tech` (1=Hugo), null (9). Hoje só é setado por trigger (farmer) ou manualmente no banco — **não editável na UI**.
- RLS: helpers prontos — `current_collab_id() uuid`, `current_collab_role() text`. Gate "só Diretor" = `current_collab_role() = 'director'`.

## Decisões travadas (Alf, 08/06)
1. **Modelo:** HÍBRIDO — mantém regras automáticas + adiciona override manual.
2. **Override:** N:N — uma pessoa pode ter **vários** líderes explícitos → exige tabela de arestas.
3. **Semântica:** ADITIVO — a aresta explícita SOMA às regras (não apaga). Toggle "ignorar regras" fica como futuro (YAGNI).
4. **Permissão de edição:** **só Diretor** (`role = 'director'`).
5. **Sem mockup visual** — seguir direto pro design textual → spec → plano.

## Arquitetura

### 1. Dado — nova tabela `governance_edges`
```
governance_edges
  member_id  uuid  NOT NULL  REFERENCES collaborators(id) ON DELETE CASCADE   -- o liderado
  leader_id  uuid  NOT NULL  REFERENCES collaborators(id) ON DELETE CASCADE   -- o líder
  created_by uuid  NULL      REFERENCES collaborators(id)
  created_at timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (member_id, leader_id)
  CHECK (member_id <> leader_id)              -- sem auto-loop
```
- **Backfill (migration):** inserir uma aresta por cada `supervisor_id` não-CEO atual (Dai→Juliana, Leo→Krissya, Matheus→Quintela). Depois disso, `supervisor_id` deixa de ser lido pelo roteamento (ver §2); a coluna fica vestigial e pode ser removida numa limpeza futura.
- **RLS:**
  - `gov_edges_select`: leitura liberada a quem está logado (o roteamento e o preview precisam ler) — `current_collab_id() IS NOT NULL`. (Dado não é sensível: é organograma interno.)
  - `gov_edges_write` (INSERT/UPDATE/DELETE): `current_collab_role() = 'director'`.
  - `gov_edges_service`: `service_role` full (TOM lê via service_role).
- **Ciclo (A→B→A):** prevenção em nível de UI (não oferecer como líder alguém que já é liderado transitivo) + nota; sem trigger recursivo agora (YAGNI).

### 2. Roteamento — somar arestas explícitas (os 2 arquivos)
Princípio inegociável: **banco = fonte única**; `team-routing.ts` (PWA) e `leader-routing.js` (TOM) recebem a MESMA mudança e os MESMOS testes.

- Estender o tipo `Collab` com `explicit_leader_ids?: string[]` (lista de `leader_id` das arestas onde a pessoa é `member`).
- Em `resolveLeadersOf`, depois das regras automáticas, adicionar cada `explicit_leader_ids` (via o mesmo `add()`, que já deduplica e ignora self/inativos). Substitui o ramo atual de `supervisor_id` (que sai do roteamento após o backfill).
- `resolveLeaderIdsOf` e `membersOf` (inversa) passam a refletir as arestas automaticamente, pois derivam de `resolveLeadersOf`.
- **Carregamento dos dados (attach):** onde os colaboradores são carregados para roteamento, carregar também `governance_edges` e anexar `explicit_leader_ids` a cada collab:
  - PWA: `web/src/lib/team-snapshot.ts` / `team-scope.ts` (já montam o array de colaboradores p/ o Dashboard time).
  - TOM: `src/rituals/dispatcher.js` (onde monta o mapa de times via `resolveLeaderIdsOf`).

### 3. UI — seção "Governança" dentro do colaborador (`GestaoEquipeDetalhe.tsx`)
Visível e editável **só para Diretor** (gate de UI espelhando a RLS). Componentes do DS (sem HTML nativo).
- **Grupo de governança (`function_role`)** — chips que DISPARAM as regras automáticas. Mapa rótulo→código:
  `Pedagógico→pedagogico` · `Marketing→marketing` · `Operações→ops_tecnicas` · `Farmer→farmer` · `Tech→tech` · `— (nenhum)→null`.
  Helper text: "define a regra automática de liderança". (Distinto de **Cargo**/`function_title`, que é só rótulo do que a pessoa faz.)
- **"Reporta a" (override manual)** — multi-seleção de colaboradores ativos → grava/remove arestas em `governance_edges` (member = pessoa aberta). Aditivo às regras.
- **Preview ao vivo (read-only)** — "Líderes resolvidos: A, B · Liderados diretos: X, Y", calculado com a MESMA `resolveLeadersOf`/`membersOf` em memória (sem ida ao servidor), refletindo function_role + unit + arestas correntes do form. É o que torna a edição "inteligente": vê o efeito na hora.

### 4. Interação com acesso (nota honesta, não-bloqueante)
A matriz define **relações** (quem cobra quem — usado pelo TOM e pelo semáforo). **Ver** o Dashboard time (`/time`) ainda depende do `role` (coordinator/director) — isso é o gate de nav, separado. Ex.: marcar Dudu→Rafinha já faz o TOM cobrar o Dudu pelo Rafinha; pro Rafinha **abrir** o /time, o role dele precisa subir. Essa parte (promover Rafinha) é o "processo do Rafinha" e fica fora deste escopo.

## Segurança
- Dev stance atual: organograma interno não é dado sensível → leitura ampla ok. Escrita travada a director via RLS (`current_collab_role()='director'`), não só no front.
- TOM escreve/lê via service_role: as arestas que o TOM usa vêm do banco (organograma), nunca de marker do LLM. (Consistente com a regra `service_role`.)

## Testes
- `team-routing.test.ts` e `leader-routing.test.js` (espelhados): 
  - aresta explícita soma ao conjunto de líderes; dedup quando regra + aresta apontam o mesmo líder; ignora self-loop; múltiplos líderes explícitos coexistem com líderes de regra; `membersOf` inverso enxerga a aresta.
  - regressão: Dai/Leo/Matheus continuam com os líderes pós-backfill.
- Validação no preview (4173): seção Governança só aparece pro Diretor; marcar "reporta a" atualiza o preview ao vivo; salvar persiste; reabrir reflete.

## Fatiamento (vira plano)
1. **Migration:** tabela `governance_edges` + RLS + CHECK + backfill dos 3 supervisor_id.
2. **Roteamento:** `explicit_leader_ids` no tipo + somar arestas em `resolveLeadersOf` (PWA `.ts` + TOM `.js`) + testes espelhados; attach nos loaders (`team-snapshot.ts` + `dispatcher.js`).
3. **UI:** seção "Governança" (function_role chips + "reporta a" N:N + preview ao vivo), gate director; hook de leitura/escrita das arestas.
4. **Validação:** preview (director vs não-director, editar/salvar/reabrir) + dry-run do TOM confirmando que a cobrança segue a matriz.

## Fora de escopo (YAGNI agora)
- Toggle "ignorar regras automáticas" por pessoa (substitutivo).
- Prevenção de ciclo via trigger recursivo no banco.
- Promover roles (o "processo do Rafinha" / acesso ao /time).
- Visualização em org-chart/árvore (só o preview textual por enquanto).
- Remover a coluna `supervisor_id` (deixar vestigial; limpar depois).

## Dúvidas em aberto
1. O "Grupo de governança" (`function_role`) editável pode confundir com o "Cargo" (`function_title`)? Mitigado por labels + helper text; alternativa futura = derivar um do outro.
2. Editar `function_role` de alguém muda o auto-roteamento de um grupo inteiro (ex.: tornar X pedagógico). É o comportamento desejado (poder e responsabilidade do Diretor) — só garantir o preview deixando isso óbvio antes de salvar.
