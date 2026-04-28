# PRD — LA Organizer

**Documento:** 06 — PRD Completo
**Versão:** 3.0
**Data:** 27 de abril de 2026
**Autor:** Luciano Alf (produto) + Claude + OpenClaw (arquitetura)
**Stakeholder:** Luciano Alf (CEO LA Music)
**Agente:** TOM
**Status:** Fase 1 funcionalmente concluída — Fase 2 (PWA) iniciando

---

## 1. Visão do produto

### 1.1 O que é

O LA Organizer é o sistema operacional de vida e trabalho da LA Music. O **TOM** — agente WhatsApp — organiza o dia a dia completo dos colaboradores — vida pessoal e profissional — através de rituais diários, gestão de projetos, checklists operacionais, hábitos pessoais e integração com Emusys. O espelho visual é um PWA mobile-first onde cada pessoa interage com suas tarefas e o gestor tem visão panorâmica do trabalho.

É uma metodologia de desenvolvimento pessoal e profissional proprietária da LA Music, transformada em software. Replicável para qualquer escola mentorada.

### 1.2 Problema

Os colaboradores da LA Music são músicos que trabalham muito, mas não têm hábito de planejamento. Projetos ficam sem prazo, tarefas passam batido, demandas novas subscrevem as anteriores. Professores esquecem de lançar presença no Emusys. Rotinas operacionais não são registradas. A coordenação não tem visibilidade real.

### 1.3 Solução

O ritual vai até onde o colaborador já vive: o WhatsApp. O TOM conduz rituais fixos (planejamento semanal, briefing diário, fechamento diário), cadastra projetos via conversa guiada, distribui e cobra tarefas, envia checklists operacionais, e lembra o professor de lançar presença no Emusys. Tudo alimenta um banco centralizado que o PWA exibe de forma visual.

### 1.4 Contexto operacional

| Dado | Valor |
|---|---|
| Alunos ativos | 1.200+ |
| Unidades | 3 (Campo Grande, Recreio, Barra) |
| Professores | ~40 |
| Staff total | ~70 |
| Usuários iniciais | ~40 |
| Sistema pedagógico | Emusys |
| WhatsApp corporativo | UAZAPI |

---

## 2. Personas

### 2.1 Colaborador
Professor, assistente pedagógico, mentor. Vive no WhatsApp. Responde bem a cobranças diretas e curtas.

### 2.2 Coordenador
Juliana, Quintela. Criam projetos, distribuem tarefas, acompanham execução. Fazem gestão pelo celular.

### 2.3 Diretor
Luciano Alf. Usa o Alfredo (OpenClaw) como interface principal. Acessa PWA quando precisa de visão detalhada.

---

## 3. Arquitetura

### 3.1 Camadas do sistema

| Camada | Componente | Status |
|---|---|---|
| Agente conversacional | TOM via WhatsApp (UAZAPI) | ✅ Fase 1 concluída |
| Backend | Node.js + Supabase (PostgreSQL) | ✅ Em produção |
| Skills e docs | 9 skills ativas + referências internas | ✅ Revisadas pelo OpenClaw |
| Proteção | 3 guards (serialização, dedupe, validação de markers) | ✅ Em produção |
| Observabilidade | ritual_logs + marker_logs + v_recent_events | ✅ Em produção |
| Resiliência | restart behavior + fallback provider + segredos | ✅ Em produção |
| Espelho visual | PWA React mobile-first | 🔄 Fase 2 — iniciando |
| Integração executiva | Alfredo (OpenClaw) | 📌 Fase 4 |

### 3.2 Privacidade por design

- `context = 'personal'`: visível apenas pelo próprio colaborador
- Hábitos: 100% privados — nem coordenador, nem diretor
- Memória e perfil: privados por padrão
- Coordenador vê dados de trabalho, nunca pessoal

---

## 4. Estado atual — Fase 1

### 4.1 O que está em produção hoje

| Funcionalidade | Status |
|---|---|
| Onboarding (5 perguntas) | ✅ |
| Briefing trabalho (8h) | ✅ |
| Briefing pessoal (7h) | ✅ |
| Fechamento do dia (19h) | ✅ |
| Planejamento semanal (domingo) | ✅ |
| Alertas de prazo e atraso | ✅ |
| Criar tarefa pessoal / trabalho / lembrete | ✅ |
| Ticar, reagendar, delegar tarefa | ✅ |
| Pedir prazo + aprovação coordenador | ✅ |
| Demanda nova vira task (não memória) | ✅ |
| Coordenador cria e delega tarefa | ✅ |
| Criar projeto 5W2H (7 perguntas) | ✅ |
| Separação pessoal × trabalho | ✅ |
| Hábitos pessoais (criar, marcar, streak) | ✅ |
| Checklists operacionais | ✅ |
| Resumo do time (coordenador, 19h30) | ✅ |
| Retrospectiva semanal (coordenador, domingo) | ✅ |
| Do not disturb (janela por colaborador) | ✅ |
| Consolidação de memória (cron domingo 22h) | ✅ |
| Tratamento de áudio (Whisper) | ✅ |
| 3 guards de proteção | ✅ |
| Observabilidade (ritual_logs + marker_logs) | ✅ |
| Resiliência (restart, fallback, segredos) | ✅ |
| 4 colaboradores cadastrados | ✅ |

### 4.2 Deferred (documentado)

| Item | Motivo |
|---|---|
| Rotação de segredos (service_role, UAZAPI) | Aguarda saída do dev solo — repo privatizado, risco aceito |
| collaborator_profiles auto-update qualitativo | Precisa de uso real com múltiplos usuários antes |
| Emusys/checklist nas seções do resumo | Aguarda tabelas completas das integrações |
| Hermes (evolução autônoma de skills) | Metacapacidade — entra após validação com usuários reais |

---

## 5. Fase 2 — PWA

### 5.1 Objetivo
Criar o espelho visual do TOM — um PWA mobile-first que permite ao colaborador ver e interagir com suas tarefas, projetos e hábitos. Para coordenadores, visão do time. Para o diretor, panorama executivo.

### 5.2 Princípios do PWA

- Mobile-first, dark mode padrão
- Espelho do banco — não duplica lógica de negócio (isso é responsabilidade do TOM/engine)
- Login via magic link por WhatsApp
- Role gating visual (colaborador ≠ coordenador ≠ diretor)
- Privacidade por design (pessoal não vaza para coordenador)

### 5.3 MVP do PWA — recorte Sprint 0

**Entram no MVP:**

| Tela | Role | Prioridade |
|---|---|---|
| Login (magic link WhatsApp) | Todos | P0 |
| Hoje | Todos | P0 |
| Semana | Todos | P0 |
| Projetos (lista) | Todos | P0 |
| Projeto detalhe | Todos | P0 |
| Configurações | Todos | P1 |
| Histórico | Todos | P1 |
| Dashboard do time | Coordenador+ | P0 |

**Ficam para depois do MVP:**

- Dashboard executivo completo
- Gestão de checklists completa
- Broadcast no PWA
- Aderência geral detalhada
- Pessoa detalhe profunda
- Agenda Emusys ultra rica
- Modais sofisticados

### 5.4 Sprint 0 do PWA

**Objetivo:** fundação técnica + 4-5 telas núcleo funcionando com dados reais do Supabase.

1. Setup: React + TypeScript + PWA + auth via magic link
2. Layout base: bottom nav, header, role gating
3. Tela Hoje: tarefas do dia + checkbox interativo
4. Tela Projetos: lista de projetos com status
5. Dashboard do time: resumo coordenador (dados já existem no banco)

---

## 6. Roadmap geral

| Fase | Conteúdo | Status |
|---|---|---|
| Fase 0 | Infraestrutura (VPS, banco, webhook) | ✅ Concluída |
| Fase 1 | TOM WhatsApp (agente completo) | ✅ Funcionalmente concluída |
| Fase 2 | PWA espelho visual | 🔄 Iniciando |
| Fase 3 | Dashboard gerencial avançado + check-in RH | 📌 Planejado |
| Fase 4 | Integração Alfredo (OpenClaw) | 📌 Planejado |
| Fase 5 | Checklists operacionais avançados + Emusys completo + Google Calendar | 📌 Planejado |
| Fase 1E | Hermes (evolução autônoma de skills) | 📌 Após validação com usuários |

---

## 7. Estratégia de rollout

1. **Agora:** Alf testa sozinho por ~1 semana
2. **Depois:** Anne Susan entra (collaborator, Campo Grande)
3. **Depois:** Juliana e Quintela (coordenadores)
4. **Produção:** time completo (~40 pessoas) — só após PWA estável

---

## 8. Decisões de arquitetura relevantes

- **Markers vs structured output:** markers (`<<ACTION>>...<<END>>`) funcionam no MVP com guard de validação. Migração para structured output considerada para Onda 1 de arquitetura.
- **engine.js:** atualmente god object — refactor planejado para Sprint de Arquitetura (Onda 1) quando Fase 2 estiver estável.
- **Segredos:** repo privatizado, rotação pendente conforme condições documentadas em `docs/secrets-audit.md`.
- **Áudio:** Whisper (OpenAI) ativo — ~$1.80/mês no volume atual.
