# Relatório Executivo — Sprint 14 + Estado do LA Organizer
**Data:** 2026-05-01
**Sprint encerrado:** 14 (Fatias 1 + 2)

---

## O que foi entregue na Sprint 14

### Fatia 1 — Tarefas de Eventos (PWA)
**Objetivo:** dar ao coordinator uma tela para gerenciar tarefas operacionais de cada evento, agrupadas por setor.

- DB: `tasks` ganhou `school_event_id`, `event_sector`, `notes`, `support_team`, status `awaiting_confirmation` + índice
- Tela `/mais/eventos/:id` com 5 acordeões (Logística, Técnica, Pedagógico, Comunicação, Produção)
- Sheet de criar/editar task com responsável principal + apoio + notas + status
- Toggle de conclusão inline, edição e exclusão com confirmação
- Acesso via card de evento na Agenda Escolar

### Fatia 2 — Auto-geração + Mapa de Equipe + Lembretes
**Objetivo:** reduzir trabalho manual: ao criar evento via TOM, o sistema gera o kit completo de tarefas e dispara lembretes automaticamente.

- DB: `school_events.event_type` (8 valores), tabela `event_team_map` (unit × sector → collaborator) com RLS, `tasks.reminded_at`
- Engine: 5 famílias de kit hardcoded (32 tasks no total) — show/recital → 9, workshop/treinamento/oficinas → 6, reunião → 4, formatura → 8, evento genérico → 5
- Atribuição automática via mapa de equipe da unidade; fallback ao criador quando não há mapa
- Dispatcher: bloco novo `remindEventTasks` envia WhatsApp T-1 às 09h BRT para tasks pendentes
- TOM skill atualizada com regras de inferência de `event_type` e novo resumo de confirmação (5ª linha)
- Tela `/mais/agenda-escolar/equipe` com tabs por unidade × 5 selects de setor

### Fora de escopo (decidido)
- ❌ **Backblaze B2** — descartado: Supabase backup + GitHub já cobrem
- ⏸️ **Override de equipe por evento** — diferido: aguarda uso real
- ⏸️ **Lembretes T-3 + T-1** — diferido: aguarda feedback (risco de spam)

---

## Estado atual do produto

### Capacidades operacionais (em produção)
- **TOM via WhatsApp**: criação de tasks, eventos, projetos, comunicados; aprovação de comunicados por director
- **PWA mobile-first**: Hoje, Semana, Projetos, Histórico, Hábitos, Checklists, Comunicados, Agenda Escolar, Observabilidade, Eventos (tasks), Equipe
- **Dispatcher**: rituais diários (briefing/closing), checklists operacionais, comunicados em fila com retry/cancel/anti-spam, lembretes de tasks de evento
- **Aprovação 2-stage**: coordinator cria comunicado → director aprova/rejeita → broadcaster envia
- **Eventos institucionais**: criação via TOM com até 4 etapas de comunicação (T-3 escola, T-1 unidade, T0 dia, imediato liderança) + auto-geração de kit de tasks
- **Operações multi-unidade**: Barra, Recreio, Campo Grande com mapa de equipe por unidade

### Infraestrutura
- VPS única hospeda 3 processos pm2: `tom` (engine + dispatcher), `la-organizer-web` (PWA), `la-organizer-tunnel`
- Supabase Postgres com RLS extensivo, helper `current_collab_role()` em uso
- Backup diário às 03h BRT via `backup.sh` + crontab → `/opt/LA-Organizer/backups/` (60d retenção local)
- Deploy: `scp` direto da máquina dev para a VPS; sem CI/CD

### Dívidas técnicas conhecidas
- **Bundle PWA 633KB minificado** — passa do limite de warning do Vite; code-splitting pendente
- **Categoria de tasks**: divergência entre frontend (`la_music`/`mentoria`/etc) e DB CHECK (`pedagogical`/`commercial`/etc) — mapeamento implícito frágil
- **`tasks.due_date` é NOT NULL** — força sempre setar prazo; event tasks defaultam para `event_date`
- **Sem testes automatizados** — verificação manual + smoke tests SQL após cada deploy
- **Sem git local no projeto** — histórico só no GitHub; deploys vão direto da máquina dev

### Métricas operacionais (instrumentação atual)
- Logs do dispatcher por tick (stdout pm2)
- Tela Observabilidade: aprovações pendentes, fila ativa, histórico, alerta de duplicidade
- Comunicados: contadores `jobs_total`, `jobs_sent`, `jobs_failed`, `jobs_cancelled`, `jobs_pending`

---

## Próximas decisões a tomar

1. **Validar Fatia 2 em uso real** (1–2 semanas) — confirmar se kits estão certos, se mapa de equipe funciona, se lembrete T-1 incomoda ou ajuda
2. **Reavaliar override de equipe e múltiplos lembretes** após validação
3. **Code-splitting da PWA** — só vira prioridade se carregamento lento começar a incomodar
4. **Testes automatizados** — só vale o esforço quando tiver mais de 1 dev

---

## Saúde do desenvolvimento

- **Velocidade:** Sprint 13 (3 fatias) + Backup + Sprint 14 (2 fatias) entregues nesta sessão de trabalho
- **Qualidade:** sem regressions reportadas; smoke tests SQL passaram em todas as fatias; tsc clean em todas as builds
- **Arquitetura:** padrões consistentes (markers TOM, set_config para RLS, kit em código vs configuração) — projeto continua legível e extensível
- **Risco principal:** ausência de testes automatizados torna refactors arriscados. Compensado por escopo pequeno e uso single-tenant.
