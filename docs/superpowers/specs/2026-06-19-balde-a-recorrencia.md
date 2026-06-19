# Balde A — Ciclo de vida da tarefa recorrente (SPEC)

**Data:** 2026-06-19
**Autor:** Claude (auditoria) · **Aprovação:** Alf + agente Alfredo
**Status:** aprovado para implementação (só código) · deploy GATEADO (5 entregáveis antes)

---

## 1. Problema (a dor #1, recorrente)

Mais de 20 usuários. Relatos idênticos (Fabi, Gabi) + 14 clusters no audit 19/06:
- "Falo pro TOM que a tarefa está feita e todo dia ele cobra de novo."
- "Excluí/concluí a tarefa e ela **volta**."
- O check-in lista **a mesma tarefa várias vezes** (vídeo da Gabi: ~8×), mas o app mostra **1**.
- "Cobrou tarefa de amanhã no fechamento de hoje" (Quintela).
- "Disse que concluiu todas, mas fechou só parte" (Anne, Kailane, Clayton).

Os lotes A–E de 15/06 mexeram em sintomas **vizinhos** e nunca tocaram a camada real → a dor persistiu.

## 2. Causa-raiz (verificada em código + dados + dry-run read-only)

Runtime auditado = produção (md5 idêntico local↔VPS de `recurrence-engine.js`, `dispatcher.js`, `engine.js`; pm2 online; logs ao vivo).

1. **Pré-materialização de 30 dias.** `recurrence-engine.js` `materializeSeries` usa `MATERIALIZE_HORIZON_DAYS=30` → uma regra seg-sex cria ~22 instâncias de uma vez. `materializeAll` (L361) seleciona templates **sem filtro de status** → template `done`/`cancelled` **continua gerando** instância nova toda madrugada (00:30 BRT).
2. **Check-in/briefing/fechamento sem dedup por série.** `checkTaskCheckins` (`dispatcher.js:5299`) faz `.lte('due_date', next7)` + `.map(t => '• '+t.title)` **sem dedup** → cada instância vira um bullet. Prova read-only (Gabi "Renovação (Ago)"): **6 linhas hoje → 1 com dedup por `recurrence_parent_id`**. (O piso de data NÃO é o que colapsa esse caso — as 6 são futuras 19→26/06 —; o piso serve pro sintoma "cobrou ontem/amanhã".)
3. **Conclusão pessoal = no-op silencioso.** `engine.js:4172` faz UPDATE pessoal **sem `.select()`/checagem de linhas** (o caminho de grupo `engine.js:4150` faz certo). 0 linhas afetadas = `error:null` = TOM diz "concluí!" e a tarefa fica `pending`.
4. **Sem regra ocorrência-vs-série.** Fechar a instância de hoje não fecha o molde; o molde segue vivo → amanhã volta.

## 3. Regra de produto — APROVADA (ratificada por Alf/Alfredo 19/06)

- **"feito" / "concluí"** numa tarefa recorrente → fecha **só a ocorrência de hoje**. TOM: *"✅ fechei a de hoje. Como é recorrente, volta amanhã."*
- **"para de me lembrar disso" / "encerra isso" / "não preciso mais fazer"** → encerra a **série inteira** (molde `done` + cancela instâncias futuras pendentes). TOM: *"✅ encerrei a recorrência — não te cobro mais isso."*
- **Ambíguo** → TOM **pergunta**: *"só a de hoje ou encerro de vez?"* (nunca chuta).

## 4. Escopo

### Dentro do Balde A (só código, reversível, zero migração de dado):
1. **`materializeAll`** — não materializar template com `status IN ('done','cancelled')`.
2. **Dedup por série + janela por ritual** em check-in, briefing e fechamento (helper puro testável).
3. **Conclusão pessoal honesta** — `.select()` + checagem de linhas; 0 linhas ⇒ NÃO confirma "concluí"; lote parcial reporta exato ("fechei A e B; C não consegui").
4. **Ação de encerrar série** (`scope: occurrence|series`) + regra na(s) skill(s) + pergunta de desambiguação. Encerrar série a pedido do usuário = **comportamento normal** (não é Balde B).

### Fora de escopo (NÃO fazer agora):
- **Balde B** — limpeza dos backlogs órfãos já no banco. Só após A observar 24–48h, e com OK explícito (escreve em tabela de backup, sem `DELETE` físico).
- **Reduzir o horizonte de 30 dias** — mantém 30 por enquanto; o dedup já resolve o display. Reduzir = follow-up de menor risco depois.
- **Latência/tamanho de prompt** (140KB / 57s por msg, visto na conversa da Juliana 19/06) — outra camada. Ataca depois.
- **Faxina dos arquivos órfãos da VPS** (`/dispatcher.js`, `/system.js` na raiz etc.) — cosmético, depois.

## 5. Comportamento esperado (antes → depois)

| Sintoma | Antes | Depois |
|---|---|---|
| Check-in da Gabi "Renovação" | 6 bullets iguais | **1 bullet** (a série, próxima ocorrência) |
| Template concluído | gera instância nova toda madrugada | **para de gerar** |
| "concluí" mas 0 linhas afetadas | TOM diz "concluí!" (mentira) | TOM: *"não consegui fechar X — me confirma?"* |
| "fiz todas" com 1 de 2 ok | "todas concluídas" | *"fechei A; B não consegui"* |
| "para de me lembrar disso" | improviso (às vezes apaga, às vezes nada) | encerra a **série** |
| Fechamento listando tarefa de amanhã | aparece | janela = hoje |

## 6. Plano de teste (sem tocar banco de prod)

- **TDD** nos helpers puros (`src/utils/`), red→green, suíte INTEIRA verde antes e depois (`node --test "src/**/*.test.js"`):
  - `dedupAndWindow(tasks, {ritual, todayYmd})` — colapsa instâncias da mesma série a 1; aplica a janela de data certa por ritual (check-in: hoje→+7; briefing/fechamento: hoje).
  - `classifyCompletionScope(userText)` — `occurrence` | `series` | `ambiguous`.
  - `interpretUpdateResult({rowCount})` — sucesso só se `rowCount >= 1`.
- **Teste seco read-only** (SELECTs, zero escrita) pra **Gabi, Fabi, Quintela, Anne, Kailane**: mostra "ANTES (N bullets) → DEPOIS (1)" e "template done ⇒ 0 novas instâncias".
- `node --check` em cada arquivo alterado.

## 7. Deploy, rollback e segurança

- Deploy = `scp` arquivo→VPS + `pm2 restart tom`. **Antes do scp:** `cp arquivo arquivo.bak-20260619` na VPS.
- **Rollback de código:** `scp` do `.bak` de volta + `pm2 restart tom` (~5s). Fonte local + GitHub permitem `revert`.
- **Kill switch:** flag/curto-circuito pra desligar só os crons de check-in/recorrência sem derrubar o TOM, se necessário.
- **Pós-deploy:** vigiar logs + query de contagem de instâncias `pending` por série pra garantir que **nenhuma tarefa legítima sumiu**.
- **Sem `DELETE` físico. Sem Balde B. Sem migração de dado.**

## 8. Critérios de aceite

- [ ] Suíte inteira verde antes e depois (mesma baseline; 2 falhas de ambiente conhecidas permanecem).
- [ ] Dry-run mostra 6→1 na Gabi e o esperado em Fabi/Quintela/Anne/Kailane, sem escrever no banco.
- [ ] `materializeAll` não gera de template `done`/`cancelled` (teste).
- [ ] Conclusão com 0 linhas NUNCA responde "concluí"; lote parcial reporta exato (teste).
- [ ] "encerra isso" fecha série; "feito" fecha só hoje; ambíguo pergunta (teste + skill).
- [ ] md5 local == VPS nos arquivos alterados após scp; pm2 online, unstable=0.
- [ ] 5 entregáveis enviados ao Alf ANTES do deploy; Balde B intocado.
