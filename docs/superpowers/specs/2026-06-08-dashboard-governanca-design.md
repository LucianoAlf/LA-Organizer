# Design — Dashboard de Governança ("Dashboard time" + Digest do TOM)

> **Data:** 2026-06-08 · **Status:** design aprovado nos mockups (brainstorming). Próximo passo: writing-plans.
> **Brief de auditoria (base):** `docs/superpowers/specs/2026-06-08-dashboard-time-audit-brief.md`.
> **Mockups aprovados:** `.superpowers/brainstorm/.../content/` (estrutura-ceo, ceo-desktop-v1, ceo-drill-person-v1, leader-desktop-v1, digest-governanca-v1, mobile-v1, config-governanca-v1).

## 1. Problema & missão
A página `/time` parou no nível "medir": 5 números mortos (não clicáveis) que dão ansiedade, escopo enganoso (empresa vs time), e **números mentirosos** (PRA HOJE 40 inclui 9 canceladas; ATRASADAS infla recorrência/inativo). Não é multi-tenant (todo líder vê a empresa inteira). Em paralelo, o TOM dispara **4 pings de governança/manhã** (scorecard 8h, compromissos 8h30, tarefas 8h45, individual 9h) com sobreposição → vira spam.

**Insight unificador:** a dashboard e as mensagens do TOM são **duas saídas de um cérebro só**. Mensagem = **push** (o que exige você); dashboard = **pull** (explorar + agir). Mesma inteligência.

**Missão por persona:**
- **CEO:** em 30s, descobrir onde o negócio trava entre os times e **sair com uma ação tomada** (1:1, cobrança, comunicado), sem abrir mais nada. Vê **tudo** e desce até a tarefa de qualquer pessoa (pra ensinar a cultura de governança em implantação).
- **Líder:** vê **só o seu time**, em fila de ação, e age no indivíduo certo antes da bola de neve.
- → **Mesma página, escopo e granularidade diferentes.**

## 2. Decisões cravadas (do brainstorming)
1. **Eixo híbrido:** CEO = semáforo de líderes (A) + faixa "precisa de você hoje" (B) no topo; Líder = fila de ação (B) do time dele. **Multi-tenant.**
2. **"Líder" = quem lidera um time**, não um cargo — cobre **coordenação, gerentes (Jereh) e marketing (Yuri)**. Fonte: heurística do `leader-routing.js` (função + unidade + supervisor) como **fonte única**, alinhando tela ↔ TOM.
3. **CEO vê tudo + drill de profundidade total:** Time › Líder › Pessoa › tarefa exata. O drill revela o que o resumo esconde (ex.: Jereh 🟢 no nível de líder, Jhonatan 🔴 no dele).
4. **Só trabalho.** Nunca aparece tarefa pessoal, hábito ou agenda pessoal em nenhuma tela/mensagem de governança. Regra dura.
5. **Números honestos** antes de tudo (ver §4). Número errado mata a confiança.
6. **Agir embutido** no v1 (botões Cobrar pelo TOM / 1:1 / Comunicado direto da tela).
7. **Digest único** (1 mensagem, **9h**, hierárquico) substitui os 4 pings. Seções: 🏆 scorecard (com badges/gamificação), 🎖️ compromissos, 📋 tarefas (formato atual **intacto**), 🔍 diagnóstico. Cauda longa → "+N na dashboard".
8. **Config de governança** em Configurações (liga/desliga, horário, seções, regras, quem recebe). Auto-save.

## 3. Frontend
- **Novo `web/src/screens/DashboardTimeDesktop.tsx`** + dispatcher por `useBreakpoint` (mobile = atual refeito / desktop = novo), seguindo o Guardrail Desktop (hoje não existe versão desktop). Token fix: `text-brand`→`text-tom` (`DashboardTime.tsx:150`).
- **CEO desktop:** topo = 4 KPIs **honestos e clicáveis** (Times em risco 6/16 · Atrasadas reais 28 · TOM hoje N cobranças/M sem resposta · Afogados) + "⚡ Precisa de você hoje". Master-detail: lista de **líderes** (semáforo 🔴→🟢, delta) à esquerda; clicar um líder abre, à direita, o **time dele** (pessoas) + tarefas; clicar uma pessoa abre o **drill da pessoa** (Time › Líder › Pessoa) com tarefas reais, contagem honesta, status de cobrança do TOM, diagnóstico e ações.
- **Líder desktop:** mesma engenharia, escopo travado ("só seu time · só trabalho"), espinha B (fila de ação do time) + coluna "Você" (fechamento + tarefas do líder, tom motivacional) + 🏅 reconhecimento (badge do scorecard pro 1:1).
- **Mobile:** mesmo cérebro condensado — KPIs 2×2, "precisa de você" no topo, drill por **toque → navegação** (não master-detail). Vale CEO e líder.
- **Ações embutidas:** botões `Cobrar pelo TOM` (dispara a cobrança citando as tarefas exatas — reusa o comando já existente "cobra [nome] sobre [tarefa]"), `Marcar 1:1`, `Comunicado`. Status da cobrança volta pra tela.
- **Interatividade que falta hoje:** StatCards viram clicáveis; `PessoaDetalhe` deixa de ser 100% read-only (ganha ações); seletor de período (hoje/semana).

## 4. Números honestos (camada de dados — pré-requisito)
Corrigir em `web/src/lib/events.ts` (`fetchTeamSnapshot`) e/ou num serviço de governança compartilhado:
- **PRA HOJE:** excluir `status='cancelled'` (hoje conta 9 canceladas → 40 falso; real 31).
- **Recorrência:** colapsar fan-out (ex.: "Dar presença" 4 linhas/dia → 1 obrigação "rotina diária, parada há Nd"). Mata o inflar 32→28.
- **Inativos:** ocultar/avisar tarefa atribuída a colaborador inativo (caso Kinho).
- **Contagem real:** trocar `array.length` truncado por `count` (hoje `.limit(50)` subconta em silêncio).
- **Rótulo de escopo:** todo número marca "do time" vs "da empresa" (hoje engana).

## 5. Multi-tenant (líder → time)
- **Fonte única:** `src/services/leader-routing.js` (`resolveLeadersOf`) — já resolve líder por função/unidade/supervisor e é o que o TOM usa. A tela passa a consumir o **mesmo** mapeamento (tela ↔ TOM batem).
- **Dado a popular/corrigir:** os times reais (Jereh→Vitória/Gabi/Jhonatan; Quintela→Dai/Matheus/Ramon/Jordan; Yuri→mkt) **não existem canônicos** hoje (supervisor_id ~15/31, 11 apontam pro CEO). Task de dados: garantir que `leader-routing` retorne os times corretos (ajuste de função/unidade/supervisor onde faltar).
- **Isolamento (decisão dev-vs-prod):** RLS é binária hoje (coord/director vê tudo) → um filtro **só na UI é cosmético** (o dado completo trafega pro browser). **Recomendação:** v1 com filtro de UI (rápido, ambiente dev), **mas** antes de líderes reais logarem em produção, criar `is_my_report(collab_id)` na RLS pra isolamento real. ⚠️ **Confirmar no review.**

## 6. Digest de governança (push) — `src/rituals/dispatcher.js`
- Consolidar os 4 envios da manhã em **1 mensagem às 9h** (configurável), hierárquica: header (1 linha sistêmica) → 🏆 Scorecard (semáforo + badges 🥇 + destaque da semana) → 🎖️ Compromissos parados → 📋 Tarefas atrasadas (**formato atual preservado**: grupos "pra você decidir / por líder / direto com você" + diagnóstico + arquivo automático) → rodapé com "abre a dashboard" + comando de cobrança.
- **Guard de tamanho:** WhatsApp ~4000 chars. Se estourar, cauda de menor urgência vira "+N na dashboard" (nada se perde — está no pull).
- **Mesma fonte da dashboard:** scorecard (`scorecard-builder.js` / `leader_scorecards`), compromissos (escalação de eventos work), tarefas (`governance-analyzer.js` / overdue), cobranças (`notifications`), silêncio (pending-followups). Um cérebro.
- **Gamificação (semente):** badges/medalhas no scorecard (destaque, streak, "subindo"). Base pra reconhecimento em reunião / premiação anual. v1 = badges no texto; gamificação plena depois.

## 7. Config de governança — Configurações (PWA)
Seção "Governança": master on/off · horário (default 9h) · toggles por seção (scorecard+badges / compromissos / tarefas / diagnóstico) · regras (alertar líder abaixo de X% · arquivar sem resposta há N dias · silêncio fim de semana) · quem recebe (CEO resumo geral; cada líder o do time dele). Auto-save (padrão já existente em Configurações).

## 8. Inteligência do TOM → alertas (já existe, só expor)
`checkOverdueTasks` (cobrança falhando), `escalation-tracker` (cobrada Nx sem efeito), `tom_audit_findings` (falha de conversa), `scorecard-builder` (semáforo+delta), `governance-analyzer.analyzePersonBacklog` (backlog+recomendação por pessoa), `checkSilentCollaborators` (sumiço 7d). Ressalvas: silêncio-crônico computar por query; `read_at` é cego (proxy = inbound após `sent_at`); tempos de resposta a ritual fora do MVP.

## 9. Escopo / não-fazer (YAGNI)
- v1 = pacote completo (fundação honesta + multi-tenant + agir-embutido + digest unificado + config), **construído em camadas testáveis** (não big-bang).
- **Fora do v1:** gamificação plena (ranking/premiação automatizada), tempos de resposta a ritual instrumentados, expansão além de "time do próprio líder".
- Não tocar dados pessoais em nenhum ponto.

## 10. Sequência de build sugerida (pro plano)
1. **Camada de dados honesta** (§4) + serviço de governança compartilhado (fonte única dashboard+digest). _Entrega sozinha: números param de mentir._
2. **CEO desktop** (KPIs clicáveis + semáforo + drill líder→pessoa) sobre a camada honesta.
3. **Multi-tenant** (`leader-routing` na tela + popular times + filtro de escopo).
4. **Líder view** + **mobile**.
5. **Agir embutido** (botões → cobrança/1:1/comunicado via TOM) + status de volta.
6. **Digest unificado** (4→1, 9h) + **Config de governança**.
7. (Pré-prod) **RLS `is_my_report`** se for pra produção com líderes reais.

## 11. Critério de sucesso
Abrir a página (ou ler o digest) e ela dizer **com quem falar e por quê** (nome + motivo + tarefa exata), com número **honesto**, escopado por persona, e **agir dali**. O líder vê só o seu; o CEO vê tudo e desce pra ensinar. O WhatsApp vira 1 ping que vale, não 4 que viram spam.

## 12. Riscos / perguntas pro review
- **Isolamento RLS** cosmético (v1 dev) vs `is_my_report` (prod) — confirmar o momento de virar real.
- **Times canônicos:** confirmar os rosters reais (Jereh/Quintela/Yuri/…) pra popular `leader-routing`.
- **Cobrar pelo TOM da UI:** confirmar reaproveitar o fluxo de cobrança existente (não criar novo marker).
