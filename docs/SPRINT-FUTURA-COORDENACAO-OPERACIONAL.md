# Sprint Futura — Coordenação Operacional + Comunicação Interna

> **Status:** RADAR — não implementar antes de discussão arquitetural completa.
> **Origem:** 29/04/2026, conversa Alf + openclaw após bug do evento "Especial Dia das Mães com a Turminha LA Music Kids".
> **Codinome:** `Coordenação Operacional` ou `Sprint 13`.

---

## 🎯 Caso real que motivou

Alf criou via WhatsApp um evento "Especial Dia das Mães com a Turminha da LA Music Kids":

- ✅ TOM perguntou nome / data / horário / local / descrição (intake básico funcionou)
- ✅ TOM disse "✅ Evento criado, Alf!"
- ❌ **Nada foi persistido no DB** (skill `none` → sem schema → sem marker)
- ❌ TOM **NÃO perguntou**: envolvidos, responsáveis, próximos passos, plano de comunicação

Quando Alf reclamou ("Você não perguntou quem serão os envolvidos..."), TOM reconheceu mas vazou meta-estrutura interna (`<details><summary>feedback memory</summary>...</details>`).

---

## 🧠 Diagnóstico do openclaw

### O que funciona hoje
TOM faz **intake de evento**:
- nome
- data/horário
- local
- descrição

### O que falta
TOM **não faz orquestração de evento**. Evento na LA não é só calendário. É:
- envolvidos
- responsáveis
- próximos passos
- coordenação operacional
- eventualmente plano de comunicação interna

---

## 📐 Modelo conceitual

| Camada | O que cobre | Skill atual? |
|--------|------------|--------------|
| **Intake** | Quando, onde, o quê | ✅ `criar-compromisso` |
| **Estruturação** | Por quê, como, quem | ✅ `cadastro-projeto-5w2h` (pra projetos) |
| **Coordenação operacional** | Responsáveis, papéis, próximos passos, plano de comunicação | ❌ FALTA |
| **Acompanhamento** | Status, aderência, métricas | 🟡 parcial (checkpoints) |

A frente nova preenche a 3ª camada.

---

## 🏗️ Proposta arquitetural (a discutir, não implementar)

### A. Schema novo: `event_orchestration`
```sql
CREATE TABLE event_orchestration (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  responsible_id UUID REFERENCES collaborators(id),  -- responsável principal
  status TEXT, -- 'planejado' | 'em_curso' | 'concluido' | 'cancelado'
  next_action TEXT,                  -- próximo passo único
  next_action_due DATE,
  communication_plan JSONB,          -- canal + público + quando
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE event_team (
  id UUID PRIMARY KEY,
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  collaborator_id UUID REFERENCES collaborators(id),
  role_in_event TEXT, -- 'coordenador' | 'professor' | 'apoio' | 'comunicacao'
  notified_at TIMESTAMPTZ
);
```

### B. Skill nova: `coordenacao-evento.md`
Trigger: após criar event via `criar-compromisso`, perguntar:
1. Quem são os responsáveis/envolvidos?
2. Qual o próximo passo concreto e quando?
3. Tem plano de comunicação (avisar pais, professores, divulgar)?

### C. PWA: nova aba no detalhe do evento
- Time do evento (membros + roles)
- Próxima ação + prazo
- Plano de comunicação

### D. TOM: notificações automáticas
- Membros do evento recebem aviso quando adicionados
- Lembrete do "próximo passo" no dia
- Coord recebe summary semanal de eventos sem responsável definido

---

## 🚦 Roadmap em fases

### Fase 1 — MVP coordenação básica
- Schema `event_orchestration` + `event_team`
- Skill `coordenacao-evento` (após `criar-compromisso`)
- PWA: aba "Coordenação" no evento

### Fase 2 — Comunicação interna
- Plano de comunicação estruturado (canal + público + quando)
- TOM dispara notificação WhatsApp pros envolvidos quando event criado
- Confirmação de leitura

### Fase 3 — Acompanhamento + métricas
- Dashboard de eventos por responsável
- Métricas de aderência (next_action concluído no prazo?)
- Cobrança automática de eventos sem next_action 48h+

---

## ❌ Vetos

- ❌ Não confundir com `cadastro-projeto-5w2h` (projeto ≠ evento)
- ❌ Não duplicar a tabela `events` — orquestração é COMPLEMENTO
- ❌ Não enviar comunicação automática sem confirmação humana na Fase 1
- ❌ Não tratar como "task list" — é um modelo de coordenação semântico

---

## ✅ Pré-requisitos pra atacar

1. Decisão de schema (acima) revisada
2. Lista canônica de roles (`coordenador`, `professor`, `apoio`, `comunicacao`?)
3. UX da pergunta de orquestração — palavras exatas
4. Política de notificação automática (opt-in? opt-out?)
5. Decidir: orquestração é só pra `events` ou também pra `projects`?

**Não atacar antes da decisão acima.**

---

## 📚 Referências da discussão

- Caso "Especial Dia das Mães com a Turminha LA Music Kids" (29/04/2026 13:33-13:55 BRT)
- TOM disse "Evento criado" sem persistir → bug de promessa-vazia (regra 12 do BLOCK_RULES não pegou pq skill era `none`)
- openclaw cravou: "intake de evento ≠ orquestração de evento"
- Doc registrado pra próxima sessão entrar fria com contexto completo
