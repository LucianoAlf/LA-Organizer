# Project Wizard — Decisão Arquitetural

**Documento:** PROJECT-WIZARD
**Versão:** 1.0
**Data:** 28 de abril de 2026
**Status:** Planejado para Sprint 8
**Autor:** Luciano Alf + Claude + OpenClaw

---

## 1. Por quê

### 1.1 Contexto

A criação de projeto no LA Organizer hoje (até Sprint 7) acontece exclusivamente via TOM no WhatsApp através da skill `cadastro-projeto-5w2h.md` — um fluxo conversacional de 7 perguntas que mapeia o framework 5W2H sem expor o jargão ao usuário. Funciona, mas tem limitações:

1. **Gate restritivo no TOM.** A skill atual tem gate de permissão para `coordinator` ou `director` apenas. Outros roles recebem: "Só coordenador ou diretor pode criar projeto."
2. **Apenas WhatsApp.** Quem não está em conversa com o TOM precisa abrir o WhatsApp, iniciar o fluxo, responder cada pergunta em separado.
3. **Sem feedback visual.** Para um fluxo formativo — onde a metodologia 5W2H é uma habilidade que se está ensinando ao time — texto WhatsApp não dá a clareza visual de progresso, campos preenchidos, validação.

### 1.2 O propósito formativo

A LA HQ tem um propósito declarado: **transformar vidas**. Esse propósito não se aplica só ao trabalho — se aplica à vida do colaborador como um todo. O treinamento de coordenação que Alf conduz com o time inclui ensinar a criar projeto com início, meio, fim, checklist, lembretes, distribuição de tarefas. Essa é uma skill pessoal e profissional.

Se o sistema só permite que coordenador crie projeto, ele contraria o próprio propósito formativo. **Todo o time precisa desenvolver a habilidade de planejar e executar projetos** — dentro e fora do trabalho.

### 1.3 Decisão

Sprint 8 entrega o **Project Wizard** — wizard visual multi-step no PWA que:

- Replica o fluxo 5W2H do TOM em telas guiadas
- É acessível a todos os colaboradores (sem gate de role)
- Diferencia comportamento por role: coord/director cria projeto direto; collaborator comum cria projeto que requer aprovação do supervisor
- Integra com o engine TOM via webhook (não duplica lógica de negócio)

---

## 2. Mapeamento step → campo do banco

A tabela `projects` (já existente) cobre todos os 7 campos do 5W2H. Sem nova tabela.

### 2.1 Estrutura dos passos

| Passo | Tela | Campos do 5W2H | Coluna no banco |
|---|---|---|---|
| 1 | Identidade | What (O quê) · Why (Por quê) | `name` · `justification` |
| 2 | Tempo e local | Where (Onde) · When (Quando) | `location` · `start_date` · `end_date` |
| 3 | Pessoas e método | Who (Quem) · How (Como) · How much (Quanto) | `description` · `methodology` · `estimated_hours_week` |
| 4 | Confirmação | Categoria | `category` |

### 2.2 Validações

| Campo | Validação |
|---|---|
| `name` | obrigatório, 3-100 chars, trim |
| `justification` | obrigatório, 10+ chars |
| `location` | obrigatório, enum (`campo_grande` / `recreio` / `barra` / `online` / `outro`) |
| `start_date` | obrigatório, ≥ hoje (no timezone São Paulo) |
| `end_date` | obrigatório, > start_date |
| `description` | obrigatório, 10+ chars |
| `methodology` | obrigatório, 10+ chars |
| `estimated_hours_week` | opcional, 0-80, default null |
| `category` | obrigatório, enum (`pedagogical` / `commercial` / `administrative` / `operational` / `event` / `infrastructure`) |

### 2.3 Campos preenchidos automaticamente

| Campo | Valor |
|---|---|
| `id` | gerado pelo banco (`gen_random_uuid()`) |
| `status` | `'planning'` |
| `progress_percent` | `0` |
| `color` | `'#3B82F6'` (default; pode ser ajustado depois via Projeto Detalhe) |
| `created_by` | `current_collab_id()` (do JWT) |
| `created_at` / `updated_at` | `now()` |
| `requires_approval` | `false` para coord/director, `true` para collaborator comum |

---

## 3. Schema — mudanças necessárias

### 3.1 Coluna nova em `projects`

```sql
ALTER TABLE projects
ADD COLUMN requires_approval boolean NOT NULL DEFAULT false;
```

Razão: diferenciar projetos que precisam de aprovação do supervisor (criados por collaborator comum) dos que entram em produção imediato (criados por coord/director).

### 3.2 RLS policy de INSERT

```sql
CREATE POLICY auth_insert_own_projects
ON projects
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = current_collab_id()
);
```

Razão: hoje a tabela `projects` só tem policies de SELECT/UPDATE para coord+. Sprint 8 precisa permitir INSERT para qualquer authenticated, com a restrição de que o `created_by` seja o próprio usuário.

### 3.3 Trigger opcional

Para projetos com `requires_approval=true`, considerar trigger que cria automaticamente uma `notification` para o supervisor:

```sql
CREATE OR REPLACE FUNCTION notify_supervisor_on_pending_project()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requires_approval = true THEN
    INSERT INTO notifications (collaborator_id, type, payload, status)
    SELECT supervisor_id, 'project_pending_approval',
           jsonb_build_object('project_id', NEW.id, 'project_name', NEW.name, 'created_by', NEW.created_by),
           'pending'
    FROM collaborators WHERE id = NEW.created_by AND supervisor_id IS NOT NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER notify_supervisor_after_project_insert
AFTER INSERT ON projects
FOR EACH ROW
EXECUTE FUNCTION notify_supervisor_on_pending_project();
```

Decisão: trigger SQL OU notificação via engine TOM. A favor do engine: já tem dispatch de WhatsApp; o trigger só popula notification, mas não envia mensagem. Recomendação: engine cuida disso via webhook (ver seção 4).

---

## 4. Integração com o engine TOM

### 4.1 Princípio "PWA é espelho"

O PWA não duplica lógica do TOM. Tudo que envolve mensagem WhatsApp, distribuição de tarefas e cálculo de quem é supervisor é responsabilidade do engine.

### 4.2 Fluxo de criação

1. **PWA** valida campos (frontend)
2. **PWA** insere row em `projects` via Supabase com `created_by = self`, `requires_approval` calculado por role
3. **PWA** dispara POST para webhook interno do engine TOM:
   ```
   POST http://89.116.73.186:3100/internal/project-created
   Headers: x-internal-secret: <INTERNAL_API_SECRET>
   Body: { "project_id": "uuid", "created_by": "uuid", "requires_approval": boolean }
   ```
4. **Engine TOM** recebe e processa:
   - Lê o projeto do banco
   - Cria checkpoints iniciais (mesmo comportamento do `<<PROJECT_CREATE>>` atual)
   - Envia mensagem WhatsApp ao criador: "✅ Sarau de Violinos criado!"
   - Se `requires_approval=true`: envia mensagem ao supervisor: "Anne criou o projeto Sarau de Violinos. Quer aprovar? Responde 'aprovo' ou 'rejeito'."

### 4.3 Por que webhook e não SQL trigger

- Engine TOM é o lugar canônico de envio WhatsApp (UAZAPI client, retry, fallback)
- Trigger SQL não tem acesso a UAZAPI
- Webhook mantém princípio de espelho: PWA apenas dispara intenção; engine executa
- Webhook permite rate limiting, autenticação, observabilidade no engine

### 4.4 Endpoint `internal/project-created`

```javascript
// pseudocódigo
app.post('/internal/project-created', async (req, res) => {
  // valida x-internal-secret header
  if (req.headers['x-internal-secret'] !== process.env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { project_id, created_by, requires_approval } = req.body;

  // busca projeto do banco
  const project = await supabase.from('projects').select('*').eq('id', project_id).single();

  // cria checkpoints iniciais (reusa lógica de <<PROJECT_CREATE>>)
  await createInitialCheckpoints(project);

  // envia mensagem WhatsApp ao criador
  await sendWhatsApp(creator.phone, `✅ ${project.name} criado!`);

  // se requires_approval, notifica supervisor
  if (requires_approval) {
    const supervisor = await getSupervisor(created_by);
    if (supervisor) {
      await sendWhatsApp(
        supervisor.phone,
        `${creator.full_name} criou o projeto ${project.name}. Quer aprovar?`
      );
    }
  }

  res.json({ ok: true });
});
```

---

## 5. UX por role

### 5.1 Coordinator / Director

- Wizard completo, 4 passos
- Após confirmação: `requires_approval=false`, status `planning`
- Engine inicia distribuição imediata de tarefas (comportamento atual)
- Tela final: "Projeto criado! O TOM já foi notificado."

### 5.2 Collaborator comum

- Wizard completo, 4 passos
- Após confirmação: `requires_approval=true`, status `planning`
- Engine notifica supervisor via WhatsApp
- Tela final: "Projeto enviado para aprovação! Quem aprova é {nome do supervisor}."
- Banner persistente em `/projetos` mostrando projetos pendentes de aprovação do próprio usuário

### 5.3 Aprovação do supervisor

- Supervisor recebe WhatsApp: "Anne criou o projeto Sarau de Violinos. Quer aprovar? Responde 'aprovo' ou 'rejeito'."
- Skill nova ou extensão de skill existente: `aprovar-projeto.md`
- "aprovo" → `requires_approval=false`, status mantém `planning`, engine distribui tarefas
- "rejeito {motivo}" → status muda para `cancelled`, criador recebe mensagem com motivo

---

## 6. Telas detalhadas

### 6.1 Layout geral

```
┌─────────────────────────────────────────┐
│  ← Novo projeto             N/4         │
│  ▓▓▓▓░░░░░░░░░░░░░░░░░░                 │
│                                          │
│  [conteúdo do passo]                    │
│                                          │
│  [← Voltar] [Continuar →]               │
└─────────────────────────────────────────┘
```

### 6.2 Passo 1 — Identidade

```
Como vai chamar esse projeto?

┌─────────────────────────────────────────┐
│ Sarau de Violinos                       │
└─────────────────────────────────────────┘

Por que esse projeto existe?

┌─────────────────────────────────────────┐
│ Celebrar 14 anos da escola e            │
│ apresentar a turma de violino.          │
│                                          │
└─────────────────────────────────────────┘
```

### 6.3 Passo 2 — Tempo e local

```
Onde vai acontecer?

[ Recreio       ▼ ]

Quando começa?              Quando termina?

[ 01/06/2026 📅 ]            [ 30/07/2026 📅 ]
```

### 6.4 Passo 3 — Pessoas e método

```
Quem vai participar?

┌─────────────────────────────────────────┐
│ Jordão lidera; equipe pedagógica de     │
│ Recreio.                                 │
└─────────────────────────────────────────┘

Como vai executar?

┌─────────────────────────────────────────┐
│ Ensaios semanais + apresentação final   │
│ no auditório.                            │
└─────────────────────────────────────────┘

Quantas horas por semana?

[ 5 ] horas/semana
```

### 6.5 Passo 4 — Confirmação

```
Confere os detalhes:

🗂️ Sarau de Violinos
🎯 Celebrar 14 anos da escola...
📍 Recreio
🗓️ 01/06 → 30/07/2026
👥 Jordão lidera; equipe pedagógica...
🛠️ Ensaios semanais + apresentação...
⏱️ 5h/semana

Que tipo de projeto é?

○ Pedagógico
○ Comercial
○ Administrativo
● Operacional
○ Evento
○ Infraestrutura

[ ← Voltar ]      [ ✓ Criar projeto ]
```

### 6.6 Tela final

```
        ✅
   Projeto criado!

🗂️ Sarau de Violinos
📅 01/06 → 30/07/2026
📍 Recreio · 5h/sem · Operacional

O TOM já foi notificado e vai começar
a distribuir as tarefas.

[ Ver projeto ]  [ Criar outro ]
```

Para collaborator comum:

```
        ⏳
   Enviado para aprovação

Aguardando aprovação de Juliana
(sua coordenadora).

[ Ver meus projetos ]
```

---

## 7. Acessibilidade e mobile

- Cada passo cabe em viewport 375px sem scroll vertical excessivo
- Inputs com altura mínima de 44px (toque)
- Botões de ação com altura 48px e contraste WCAG AA
- Date picker nativo (`<input type="date">`) para evitar libs externas
- Select de location e category usa `<select>` nativo no mobile
- Tabs de navegação (← Voltar / Continuar →) sempre visíveis no rodapé do passo
- Barra de progresso fixa no topo

---

## 8. Estados de erro

| Cenário | UX |
|---|---|
| Validação inline falha (campo curto, end_date < start_date) | Mensagem em vermelho abaixo do campo, CTA "Continuar" desabilitado |
| INSERT falha (RLS, network) | Toast de erro + manter dados preenchidos no estado local; permitir retry |
| Webhook do engine falha | Projeto foi criado no banco, mas notificação não saiu — engine tem retry; PWA exibe sucesso normalmente |
| Volta no passo perdendo dados | Estado mantido em `useState` do componente do wizard; voltar ao passo anterior preserva preenchimento |

---

## 9. Métricas de sucesso

Após Sprint 8 entregar:

1. **Adoção:** % de novos projetos criados via PWA vs WhatsApp
2. **Conclusão do funil:** % de wizards iniciados que chegam ao passo 4
3. **Tempo médio de preenchimento:** mediana entre passo 1 e passo 4
4. **Aprovação:** % de projetos com `requires_approval=true` que viram aprovados em 48h
5. **Qualidade do preenchimento:** comparar tamanho médio de `description` e `methodology` via PWA vs via TOM (proxy de engajamento)

---

## 10. Não entra na Sprint 8

| Item | Motivo |
|---|---|
| Edição de projeto via wizard | Fora de escopo — usar tela de Projeto Detalhe |
| Adicionar membros no wizard | Fora de escopo — usar Projeto Detalhe |
| Anexos / imagens no projeto | Sprint 9+ |
| Templates de projeto | Sprint 9+ |
| Wizard para criar checkpoint individual | Sprint 9+ |
| Wizard de delegação | Sprint 9+ |
| Wizard mobile-only (versão desktop não-implementada) | Mobile-first vale também aqui — desktop herda |
| Internacionalização | Hardcode pt-BR |

---

## 11. Definição de pronto

Sprint 8 fecha quando:

1. Tabela `projects` tem coluna `requires_approval`, RLS policy `auth_insert_own_projects` ativa, suite RLS continua verde
2. Rota `/projetos/novo` acessível a authenticated, redireciona unauthenticated para login
3. Wizard 4 passos funciona ponta-a-ponta no celular real
4. Validações inline funcionam (testar cada campo obrigatório)
5. INSERT em `projects` cria row com todos os 7 campos do 5W2H + `requires_approval` correto por role
6. Webhook `/internal/project-created` é chamado e engine processa
7. Engine envia WhatsApp confirmação ao criador
8. Engine envia WhatsApp ao supervisor se `requires_approval=true`
9. Tela final mostra confirmação ou "aguardando aprovação"
10. Skill `aprovar-projeto.md` permite supervisor aprovar/rejeitar via WhatsApp
11. Smoke E2E real: collaborator cria projeto → supervisor recebe WhatsApp → aprova → projeto vai para `requires_approval=false` → engine distribui tarefas
12. Documentação: `docs/PROJECT-WIZARD.md` (este doc) atualizado, `docs/05-mapa-telas-pwa-v3.md` com Tela 9, `docs/06-prd-la-organizer-v3.md` com seção 6, README atualizado
13. Sem regressão Sprints 0→7 (suite RLS verde, smoke das telas existentes)
14. Build verde, dark/light coerentes
15. Commit + push

---

## 12. Riscos

| Risco | Mitigação |
|---|---|
| Wizard virar formulário denso | Limite estrito de 4 passos, máximo 3 campos por passo |
| Validações pegando o usuário desprevenido | Validação inline em tempo real, não só no submit |
| Webhook engine cair e projeto ficar órfão | Engine tem retry; PWA sempre confirma sucesso após INSERT (criação atômica) |
| RLS de INSERT muito permissiva | WITH CHECK (`created_by = current_collab_id()`) evita criar para outro |
| Collaborator criar 100 projetos para spam | Sprint 8 não faz rate limit; Sprint 9+ se aparecer abuso |
| Categoria errada | Default `operational`; coord pode editar via Projeto Detalhe depois |
| End_date no passado | Validação inline bloqueia |
| Skill `aprovar-projeto.md` quebrar fluxo do TOM existente | Skill nova com pickSkill priority < skills críticas; smoke E2E exigido |

---

## 13. Referências cruzadas

- Skill backend: `skills/cadastro-projeto-5w2h.md`
- Schema: `docs/03-esquema-banco-dados-la-organizer.md` (tabela `projects`)
- Mapa de telas: `docs/05-mapa-telas-pwa-v3.md` (Tela 9)
- PRD: `docs/06-prd-la-organizer-v3.md` (seção 6)
- RLS: `docs/RLS-MATRIX.md`
- Treinamento de coordenação: `treinamento-coordenacao.html`
