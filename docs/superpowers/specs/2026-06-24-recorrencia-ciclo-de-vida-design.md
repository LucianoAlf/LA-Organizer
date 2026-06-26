# SPEC — Ciclo de vida da recorrência: separar "concluir ocorrência" de "encerrar série"

> 🛑 **JÁ IMPLEMENTADO / HISTÓRICO — NÃO IMPLEMENTAR A PARTIR DAQUI.**
> Esta Raiz 1 foi entregue **independentemente pelo chat do Financeiro** e está **VIVA em produção** (24/06): coluna `series_ended_at` + flip do guard (`recurrence-guard` checa **série encerrada**, não status da ocorrência) + backfill (≈35 séries encerradas / ≈12 ativas) + `endSeries`/`editTaskSeries` gravando o encerramento + golden tests no ar. KIs: `RECUR-LIFECYCLE-FLIP-F2`, `RECUR-REVIVE-TEMPLATE-LIMIT5`, `RECUR-RESURRECT-CALLER-GUARD`.
> O **design abaixo está correto** — é literalmente o que foi construído (Abordagem B, forward-only, Fatias 0→3). Implementar de novo = re-flipar o guard vivo + re-rodar o backfill + migration conflitante = **regressão garantida ("flip sobre flip")**. Mantido só como **registro de design**.

- **Data:** 2026-06-24
- **Status:** ✅ IMPLEMENTADO (pelo chat Financeiro) — documento histórico, não acionável
- **Autor:** Claude (sessão auditoria Gabi)
- **Relacionado:** `2026-06-19-balde-a-recorrencia.md` (Balde A), KI `RECUR-RESURRECT-CALLER-GUARD`, `RECUR-TEMPLATE-DUP`, `DESKTOP-RECUR-TEMPLATE-HIDDEN`, memória `project_recurrence_lifecycle_rootcause`

---

## 1. Contexto e problema

No schema atual, uma série recorrente é **1 TEMPLATE** (`recurrence_rule != null`, `recurrence_parent_id = null`) que **também é a 1ª ocorrência** (tem `due_date` = âncora e aparece na agenda como a primeira tarefa) **+ N INSTÂNCIAS** (`recurrence_parent_id = template.id`).

**A conflação que é a raiz da dor #1:** como o template É a 1ª ocorrência, **concluir a 1ª ocorrência marca o template inteiro como `done`**. E a geração de instâncias (`materializeAll` + o chokepoint `recurrence-guard` de hoje) **pula molde `done`/`cancelled`**. Resultado: concluir a 1ª ocorrência **congela a série** — ela para de gerar e as instâncias futuras já materializadas viram resíduo.

O sistema **não consegue distinguir** dois intentos que hoje viram a mesma ação (`status=done` no template):
- "**Concluí a ocorrência de hoje**" → a série DEVE continuar.
- "**Terminei com isso de vez**" → a série DEVE parar.

### O que já foi resolvido (não faz parte desta spec, é a base)
- **Ressurreição "apago e volta"** (`RECUR-RESURRECT-CALLER-GUARD`, 24/06): o guard "não materializar molde fechado" foi centralizado num chokepoint (`src/services/recurrence-guard.js`) ligado em `materializeSeries` (backend) e `materializeSeriesClient` (PWA), além do `materializeAll`. As 4 portas de materialização estão trancadas. **Isto FICA.**

### O que sobra (o que esta spec resolve)
1. **A conflação** acima (o root): concluir ocorrência ≠ encerrar série.
2. **163 instâncias congeladas** de molde `done` (Daiana 52, Jhonatan 26, Clayton 25, Fefê 23, Ana 5, Krissya 2 + sem-dono 30) — séries legítimas que pararam de gerar porque alguém concluiu a 1ª ocorrência.
3. **Molde duplicado na criação** (caso Gabi/Jereh: 2 templates idênticos criados com 3 min de diferença numa delegação) — fonte do "quadruplicou".

---

## 2. Objetivos / Não-objetivos

### Objetivos
- Concluir **qualquer** ocorrência (inclusive a 1ª/template) **nunca** encerra nem congela a série.
- "**Encerrar a série**" vira um estado **explícito e separado** da conclusão de ocorrência.
- A geração de instâncias passa a depender do **ciclo de vida da série**, não do `status` da ocorrência.
- **Zero regressão** para dados existentes (forward-only: o que está hoje continua se comportando como hoje).
- Prevenir criação de **molde duplicado** para a mesma pessoa+título já ativos.

### Não-objetivos (NÃO mexer)
- **Voz/comportamento do TOM** (sagrado) — só mudam mecânica de persistência e a pergunta de desambiguação que já foi ratificada em 19/06.
- O **fix da ressurreição** (chokepoint) — fica intacto.
- O **modelo de exibição** da agenda (template = 1ª ocorrência visível) — NÃO muda (é o que torna esta abordagem segura).
- Materialização em si (horizonte, dedup por dia, RECUR-TEMPLATE-DUP) — fica.

---

## 3. Decisão de design

### Escolhida: Abordagem B — ciclo de vida explícito da série (`series_ended_at`), aditivo

Nova coluna `tasks.series_ended_at timestamptz NULL` no **template**. A geração passa a perguntar **"a série foi encerrada?"** (`series_ended_at IS NULL` = ativa), em vez de **"a ocorrência foi concluída?"** (`status`).

- Concluir a 1ª ocorrência → `status=done` no template, **mas `series_ended_at` continua NULL** → a série **segue gerando** as ocorrências 2..N. Correto.
- Encerrar a série (ação explícita: "para de me lembrar / encerra isso", ou botão no app) → `series_ended_at = now()` → geração para + cancela instâncias futuras (o `endSeries` já cancela).
- O chokepoint de hoje (`recurrence-guard`) muda o critério de "status fechado" para "série encerrada". **Como a decisão JÁ está centralizada num ponto único, a mudança é cirúrgica.**

**Por que B e não A (template virar blueprint puro, nunca uma ocorrência):**
A (modelo "limpo") exige **migração de dados** (quebrar cada template-ocorrência em blueprint + 1ª instância) e **reverter a exibição da agenda** (`DESKTOP-RECUR-TEMPLATE-HIDDEN`), tocando agenda, briefing, fechamento, pacotes de grupo e governança de uma vez — o maior raio de explosão no subsistema mais frágil. B entrega o MESMO comportamento correto sendo **aditivo** (1 coluna), **sem migração destrutiva** e **sem tocar a exibição**. A fica registrada como evolução futura, se um dia valer.

---

## 4. Mudanças concretas (pequenas e centralizadas)

1. **Migration (aditiva):** `ALTER TABLE tasks ADD COLUMN series_ended_at timestamptz NULL;`
   - **Backfill forward-only (a trava anti-regressão):** para todo template existente com `status IN ('done','cancelled')`, setar `series_ended_at = COALESCE(completed_at, updated_at)`. Assim **tudo que está congelado/encerrado hoje permanece encerrado** — nada "ressuscita" no deploy. O modelo novo só vale pra ocorrências concluídas **depois** do deploy.

2. **`recurrence-guard.js` (chokepoint):** `shouldMaterializeTemplate` passa a retornar `false` quando `series_ended_at != null` (em vez de `status in done/cancelled`). Mantém fail-open.

3. **`recurrence-engine.js` `materializeAll`:** filtro da query troca `.not('status','in','("done","cancelled")')` por `.is('series_ended_at', null)`.

4. **`materialize-recurrence.ts` (PWA):** espelha o guard por `series_ended_at`.

5. **Encerrar série** (`endSeries` no grupo + ramo `scope:"series"` no engine 1:1): setar `series_ended_at = now()` no template (além de cancelar as instâncias futuras, que já fazem). `status='cancelled'` do template deixa de ser o sinal de "ended" (mas continua aceito no backfill por compat).

6. **Caminhos de conclusão:** garantir que **nenhum** path de complete (engine, PWA, grupo) escreva `series_ended_at`. (Conferência, provavelmente zero mudança.)

7. **Dedup-on-create (molde duplicado):** ao criar tarefa recorrente (engine 1:1 + PWA QuickCreate), se já existe template **ativo** (`series_ended_at IS NULL`) com mesmo `assigned_to` + título similar + mesma `recurrence_rule`, **não cria 2º** — reaproveita/avisa. (Espelha o `findDuplicatePackage` que já existe no lado grupo.)

8. **Heal dos 163:** ficam com `series_ended_at` preenchido pelo backfill (= encerrados → drenam, sem nova geração, **sem regressão**). Para **reativar** uma série específica sob demanda (dono pediu): script que limpa `series_ended_at` + re-materializa. Volume baixo, caso a caso. (Ver Decisão em aberto #1.)

---

## 5. Semântica (alinhada ao ratificado 19/06)

- "**feito / concluí**" → fecha **só a ocorrência** (default). Série continua.
- "**para de me lembrar / encerra isso / não preciso mais**" → **encerra a série** (`scope:"series"` já existe).
- **Ambíguo** → TOM pergunta "*só a de hoje ou encerro de vez?*" (comportamento já ratificado; mudança mínima de voz).
- App: afordância explícita de "encerrar série" (ver Decisão em aberto #2).

---

## 6. Risco e segurança (o "cuidado" que o Alf exigiu)

- **Forward-only é a trava-mestra:** o backfill faz todo dado atual nascer já "encerrado" se estava fechado → **o deploy não muda o comportamento de nenhuma série existente**. Só ocorrências concluídas DEPOIS do deploy seguem o modelo novo. Isso elimina o "consertou um, quebrou outro" para os dados em produção.
- **Decisão de geração já é central** (chokepoint + 1 query do `materializeAll`) → poucos pontos de mudança, fácil de revisar.
- **Testes de caracterização ANTES de tocar no código** (golden master — ver §7).
- **Incremental:** migration+backfill primeiro (sem efeito comportamental), depois flip do critério, depois encerrar-série, depois dedup-create, depois UX.
- **Rollback:** coluna aditiva (ignorável); flip do critério revertível; backfill reversível. Backup dos arquivos + originais estagiados antes do deploy.

---

## 7. Estratégia de testes

**Primeiro escrever os testes que fotografam o comportamento atual** (rede de segurança), depois implementar:
- Concluir a 1ª ocorrência de uma série nova → série **continua** gerando 2..N. *(novo comportamento — começa vermelho, fica verde com o fix)*
- Encerrar série (`scope:series`) → para de gerar + instâncias futuras canceladas. *(deve continuar verde)*
- Deletar instância de série **ativa** → re-materializa (correto). *(caracterização)*
- Deletar instância de série **encerrada** → **não** volta (o fix da ressurreição de hoje). *(deve continuar verde)*
- Dado existente (template `done` pré-deploy, backfill aplicado) → **não** gera nada novo. *(anti-regressão)*
- `recurrence-guard` puro: `series_ended_at` set → false; null → true; fail-open mantido.
- dedup-on-create: 2º template idêntico ativo → bloqueado; título diferente / série encerrada → permite.
- Suíte JS backend tem que ficar no baseline (1167/1169, 2 falhas de env). tsc PWA 0.

---

## 8. Rollout em fatias (cada uma verificável e reversível)

1. **Fatia 0 — rede:** testes de caracterização do estado atual (verde no que existe).
2. **Fatia 1 — migration + backfill** (aditivo, zero efeito comportamental; verifica que nada gera diferente).
3. **Fatia 2 — flip do critério** (guard + materializeAll + PWA para `series_ended_at`).
4. **Fatia 3 — encerrar série** grava `series_ended_at` (engine + grupo).
5. **Fatia 4 — dedup-on-create** (1:1 + PWA).
6. **Fatia 5 — UX de desambiguação** (mínima, ratificada).
7. **Heal sob demanda** dos 163 — fora da esteira de código, caso a caso.

---

## 9. Decisões em aberto (default escolhido — só confirma ou ajusta, sem Q&A)

1. **Os 163 congelados:** default = **deixar drenar** (backfill os marca encerrados; reativo só sob demanda quando um dono reclamar). Alternativa: tentar reativar em massa (risco de ressuscitar nag pra quem queria parar). → **Recomendo o default.**
2. **Botão "encerrar série" no app:** default = **incluir nesta entrega** (afordância simples no card da tarefa recorrente). Alternativa: deixar só via TOM ("para de me lembrar") nesta rodada e o botão depois. → **Recomendo incluir** (senão o usuário do app não tem como encerrar sem o TOM).
3. **Disambiguação na conclusão:** default = **manter como hoje** (TOM pergunta no ambíguo; concluir = só ocorrência). Sem mexer mais na voz.

---

## 10. O que explicitamente NÃO muda
- Voz/tom/tamanho das respostas do TOM.
- Fix da ressurreição (chokepoint) — fica.
- Exibição da agenda (template = 1ª ocorrência) — fica.
- Materialização (horizonte, dedup por dia) — fica.
- Pacotes de grupo (estrutura mãe/filha) — só herdam o `series_ended_at` no molde, sem reestruturar.
