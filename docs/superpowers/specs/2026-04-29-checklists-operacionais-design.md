# Spec: Checklists Operacionais
**Data:** 2026-04-29  
**Sprint:** 11 F2+ (PRD Sprint 8+, atrasado)  
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

LA Music tem 3 unidades (Barra, Recreio, Campo Grande). Colaboradores com funções recorrentes (secretária, assistente pedagógica, limpeza) precisam executar checklists diários — abertura, fechamento, fiscalização de salas. Hoje isso é feito de cabeça ou no papel. O objetivo é digitalizar via WhatsApp + PWA com rastreamento de aderência.

**Distinção importante:**
- **Checklist Operacional** (esta feature): recorrente, diário, disparado por cron, para rotinas fixas (verbo: "Ligar sistemas")
- **Checklist de Evento/Projeto** (sprint futura): one-shot, vinculado a projeto específico, setores, mapa de equipe, linha do tempo

---

## Decisões de design (P1–P8)

| # | Decisão | Escolha |
|---|---|---|
| P1 | Quem cria templates | **C — Híbrido**: seed 4 templates fixos agora; CRUD pelo coord na Sprint 2 |
| P2 | Vínculo collab ↔ template | **C — Híbrido**: auto-match por (function_role, unit, shift); overrides table quando necessário |
| P3 | Frequência | **B**: `days_of_week int[]` por template (ex: `[1,2,3,4,5]`) |
| P4 | Turnos | **B**: `dispatch_time TIME` por template (não hardcoded global) |
| P5 | Canal de marcação | **C — Dual**: WhatsApp + PWA escrevem na mesma tabela com campo `channel` |
| P6 | Templates por unidade | **C — Global com override**: `unit='all'` padrão; específico tem prioridade no cron |
| P7 | Retroatividade | **B — Janela 6h**: `dispatch_time + 6h`; fora da janela → `late=true`, conta no histórico, não no KPI |
| P8 | KPI de aderência | **C — Threshold configurável**: `completion_threshold int default 80` por template |

---

## Abordagem arquitetural

**Abordagem 2 — Dual-channel real** (aprovada)

- WhatsApp: "feito tudo" / "1 3 5" → `<<CHECKLIST_ACTION>>` → engine → DB com `channel='whatsapp'`
- PWA: nova tela `/checklists`, toque por item → escrita direta Supabase com `channel='pwa'`
- Realtime subscription: marcação no WhatsApp reflete no PWA em ~1s
- Janela 6h e threshold 80% aplicados em ambos os caminhos

---

## Seção 1: Schema & Data Model

### Migration

```sql
-- op_checklists: adicionar colunas ausentes
ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS completion_threshold int NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS dispatch_time TIME NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS days_of_week int[] NOT NULL DEFAULT ARRAY[1,2,3,4,5];
-- unit TEXT já existe com default 'all'

-- op_checklist_completions: registrar quando o dispatch aconteceu (guard anti-double-send)
ALTER TABLE op_checklist_completions
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

-- op_checklist_item_completions: adicionar colunas ausentes
ALTER TABLE op_checklist_item_completions
  ADD COLUMN IF NOT EXISTS late boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp';
-- channel: 'pwa' | 'whatsapp'
```

### Seed — 4 templates iniciais

| name | function_role | unit | shift | days_of_week | dispatch_time | threshold |
|---|---|---|---|---|---|---|
| Abertura Escola | secretary_morning | all | morning | [1,2,3,4,5] | 07:30 | 80 |
| Fechamento Escola | secretary_evening | all | evening | [1,2,3,4,5] | 21:30 | 80 |
| Fiscalização Salas | pedagogical_assistant | all | afternoon | [1,2,3,4,5,6] | 13:00 | 80 |
| Limpeza | cleaning | all | full | [1,2,3,4,5,6] | 07:00 | 100 |

### Itens de seed por template

**Abertura Escola** (secretary_morning, threshold 80%)
1. Abrir portões e recepção
2. Ligar sistemas de som das salas
3. Conferir ar-condicionado das salas
4. Verificar presença de professores do turno
5. Checar agenda do dia no sistema
6. Organizar recepção e material de boas-vindas
7. Registrar horário de abertura

**Fechamento Escola** (secretary_evening, threshold 80%)
1. Confirmar saída de todos os alunos
2. Desligar sistemas de som
3. Desligar ar-condicionados
4. Fechar e trancar salas
5. Verificar luzes e ventiladores
6. Fechar portões e acionar alarme
7. Registrar horário de fechamento

**Fiscalização Salas** (pedagogical_assistant, threshold 80%)
1. Verificar limpeza das salas
2. Conferir equipamentos (teclados, amplificadores, cabos)
3. Checar quadros e material didático
4. Registrar sala com problema (se houver)
5. Confirmar que salas estão prontas para o próximo turno
6. Comunicar manutenção pendente ao coordenador

**Limpeza** (cleaning, threshold 100%)
1. Limpar e varrer recepção
2. Limpar banheiros (masculino e feminino)
3. Limpar e organizar salas de aula
4. Recolher lixo de todas as áreas
5. Lavar área de copa/cozinha
6. Passar pano úmido nos corredores
7. Repor papel higiênico e sabonete

### Regra de resolução de unit no cron
```
Para colaborador com unit = 'campo_grande':
  1. Busca template com unit='campo_grande' + mesmo (function_role, shift)
  2. Se encontrado → usa o específico
  3. Se não → usa template com unit='all' + mesmo (function_role, shift)
```

### Constraint de dedup
```sql
-- previne double-dispatch
UNIQUE (collaborator_id, template_id, completion_date) ON op_checklist_completions
```

---

## Seção 2: Dispatch Layer

**Arquivo:** `src/rituals/dispatcher.js` — nova função `dispatchChecklists(now, { dry })`

**Frequência:** chamada no loop principal do dispatcher (PM2 cron a cada 5 min)

**Lógica:**
```
dispatchChecklists(now, { dry = false }):
  today_dow = dayOfWeek(now, 'America/Sao_Paulo')  // 1=seg … 7=dom
  window_start = now - 5min

  templates = SELECT * FROM op_checklists
    WHERE days_of_week @> ARRAY[today_dow]
      AND dispatch_time BETWEEN window_start AND now

  Para cada template:
    candidates = colaboradores com function_role = template.function_role
                 AND shift = template.shift
                 AND (template.unit = 'all' OR collab.unit = template.unit)
    candidates = deduped por collab_id (específico ganha sobre global)

    Para cada collab:
      Se já existe op_checklist_completions(collab, template, today) → skip
      Se dry=true → log would_dispatch, continua
      Cria op_checklist_completions(status='pending', completion_date=today)
      Envia WhatsApp com lista numerada dos itens
      Registra dispatched_at = NOW()
```

**Mensagem WhatsApp:**
```
📋 *Checklist: Abertura Escola*
Marque os itens concluídos:
1. Abrir portões e recepção
2. Ligar sistemas de som
...
Responda com os números (ex: *1 3 5*) ou *feito tudo*.
```

**Dry-run:** `dispatchChecklists(now, { dry: true })` retorna `[{ collab_id, template_id, would_dispatch, reason }]` para inspeção antes do primeiro deploy.

---

## Seção 3: WhatsApp Interaction

### Skill `checklist-tarefas.md` — parsing

| Input | Parse | Ação |
|---|---|---|
| "feito tudo" / "ok tudo" / "✅" | todos os itens | marca todos `done=true` |
| "1 3 5" / "1, 3, 5" / "items 1 2" | lista de números | marca itens posicionais |
| "pulei o 2" / "não fiz o 3" | exclusão | marca todos exceto citados |
| Ambíguo | não parseia | TOM pede confirmação (timeout 2min → não persiste) |

TOM identifica `completion_id` ativo: mais recente com `status='pending'` E dentro da janela 6h para o colaborador.

### Marker `<<CHECKLIST_ACTION>>`
```json
<<CHECKLIST_ACTION>>
{
  "completion_id": "uuid",
  "items": [
    { "item_id": "uuid", "done": true },
    { "item_id": "uuid", "done": false }
  ],
  "channel": "whatsapp"
}
<</CHECKLIST_ACTION>>
```

### Engine — `applyChecklistAction()`
```
1. Valida janela: NOW() <= completion.dispatched_at + 6h
   - Dentro → late=false
   - Fora → late=true (persiste mas não conta no KPI)

2. Para cada item: UPSERT op_checklist_item_completions
   ON CONFLICT (completion_id, item_id) DO UPDATE

3. Recalcula progresso:
   pct = COUNT(done=true) / COUNT(*) * 100

4. Se pct >= template.completion_threshold:
   UPDATE op_checklist_completions SET completed_at = NOW()

5. TOM confirma:
   "✅ Checklist Abertura Escola — 9/10 (90%). Registrado!"
   ou
   "⚠️ 6/10 (60%) — abaixo do mínimo (80%). Registrado como parcial."
```

---

## Seção 4: PWA

### Nova rota: `/checklists`
Nova entrada na navegação principal ao lado de Hoje / Projetos / Hábitos.

### Componentes
```
Checklists.tsx (screen)
├── ChecklistCard.tsx
│   ├── nome do template + badge de status
│   ├── barra de progresso (X/Y itens, %)
│   └── ChecklistItemRow.tsx  (toggle tap)
└── EmptyState  (nenhum checklist hoje)
```

### Badges de status
| Estado | Badge |
|---|---|
| `completed_at` preenchido | ✅ Completo (verde) |
| dentro da janela, pendente | 🔄 Em andamento |
| fora da janela, não completo | ⏰ Encerrado (cinza, somente leitura) |
| `late=true` em algum item | ⚠️ Parcial fora do prazo (amarelo) |

### Toggle de item (PWA → Supabase)
```ts
const toggleItem = async (itemId: string, currentDone: boolean) => {
  await supabase.from('op_checklist_item_completions').upsert({
    completion_id,
    item_id: itemId,
    done: !currentDone,
    channel: 'pwa',
    late: isOutsideWindow(completion.dispatched_at),
  }, { onConflict: 'completion_id,item_id' })
  // threshold check: recalcula localmente + invalida query
  queryClient.invalidateQueries(['checklists'])
}
```

### Realtime subscription
```ts
supabase.channel('checklist-realtime')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'op_checklist_item_completions',
    filter: `completion_id=in.(${completionIds.join(',')})`,
  }, () => queryClient.invalidateQueries(['checklists']))
  .subscribe()
```

Fallback se realtime cair: React Query refetch a cada 30s. Badge "🔄 sincronizando..." desaparece após reconexão.

---

## Seção 5: Error Handling & Edge Cases

| Caso | Comportamento |
|---|---|
| Nenhum colaborador para o template | Skip silencioso, log de aviso |
| Resposta fora da janela 6h | Persiste `late=true`, TOM avisa |
| Resposta ambígua no WhatsApp | TOM pede confirmação; sem resposta em 2min → não persiste |
| Colaborador responde em checklist já completo | UPSERT sobrescreve item; `completed_at` não é regravado se threshold já atingido |
| Realtime cai no PWA | Degrada para refetch a cada 30s |
| Dispatch duplicado (PM2 restart) | `ON CONFLICT DO NOTHING` + guard `dispatched_at` previne segundo envio |
| Template com `days_of_week` vazio ou `dispatch_time` nulo | Validação no seed/CRUD; skip no cron com log de erro |

---

## Seção 6: Testing Strategy

### 6.1 DB / API (chamadas Supabase diretas)
- Migration: confirmar 5 colunas novas via `information_schema.columns`
- Seed: SELECT nos 4 templates
- Dedup: inserir `op_checklist_completions` duas vezes → COUNT permanece 1
- Janela within (dispatch + 3h): `late=false`
- Janela outside (dispatch + 7h): `late=true`
- Threshold 80%: 8/10 done → `completed_at` preenchido; 7/10 → null
- Unit priority: template específico ganha sobre `unit='all'`

### 6.2 Integração (WhatsApp → Engine → DB)
- "feito tudo" → todos `done=true`, `completed_at` preenchido
- "1 3 5" → só itens 1, 3, 5 `done=true`
- Reenvio após parcial → UPSERT sobrescreve, `completed_at` atualiza

### 6.3 PWA (Playwright)
1. Login com colaborador com checklist hoje → card aparece em `/checklists`
2. Tap em item pendente → `done=true` no DB com `channel='pwa'`
3. Tap em item marcado → `done=false` (desfaz)
4. Marcar 8/10 itens (threshold=80%) → badge ✅ Completo, `completed_at` preenchido
5. Simular WhatsApp marcar item enquanto PWA aberto → realtime atualiza sem reload
6. Abrir checklist fora da janela → itens somente leitura, badge "Encerrado"

### 6.4 Cron dry-run
`dispatchChecklists(now, { dry: true })` → inspecionar lista de `{ collab_id, template_id, would_dispatch, reason }` antes do primeiro deploy em produção.

---

## Fora de escopo (Sprint 2 / futuro)

- CRUD de templates pelo coord no PWA
- Dashboard do coordenador (visão de todos os colaboradores)
- Observações por item de checklist
- Fotos em itens
- KPI histórico 30d / relatório de aderência
- Checklist de Produção de Eventos (feature separada — ver chip de sprint futura)
