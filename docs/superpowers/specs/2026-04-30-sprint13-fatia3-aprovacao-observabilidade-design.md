# Spec: Aprovação + Observabilidade — Sprint 13 Fatia 3
**Data:** 2026-04-30
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Fatia 1 entregou anúncios segmentados despachados por cron. Fatia 2 adicionou eventos institucionais com plano de comunicação automático. Fatia 3 adiciona:

1. **Fluxo de aprovação:** comunicados criados por coordinator ficam em `pending_approval`; director aprova ou rejeita via TOM (WhatsApp) ou PWA antes do despacho.
2. **Dashboard de observabilidade:** tela PWA com fila de aprovação, fila ao vivo, histórico de métricas por comunicado e alerta de duplicidade.

O broadcaster da Fatia 1 **não precisa de nenhuma alteração** — já ignora tudo que não é `scheduled/sending`.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Escopo da aprovação | Só comunicados criados por coordinator |
| P2 | Canais de aprovação | TOM (WhatsApp) + PWA |
| P3 | Notificação ao director | TOM envia WhatsApp imediatamente ao criar |
| P4 | Motivo de rejeição | Opcional (pode rejeitar sem motivo) |
| P5 | Notificação ao coordinator | Sim, via WhatsApp ao aprovar ou rejeitar |
| P6 | Observabilidade | Só PWA (`/mais/observabilidade`) |
| P7 | Métricas | Por comunicado (sent/failed/cancelled) + fila ao vivo + alerta de duplicidade + fila de aprovação |
| P8 | Abordagem arquitetural | Estender máquina de estados de `announcements` (Abordagem 1) |

---

## Seção 1: Schema & Máquina de Estados

### Migration

```sql
-- 1. Estender o CHECK de status
ALTER TABLE announcements
  DROP CONSTRAINT announcements_status_check,
  ADD CONSTRAINT announcements_status_check
    CHECK (status IN ('pending_approval','scheduled','sending','sent','cancelled','rejected'));

-- 2. Auditoria de aprovação
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES collaborators(id),
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- 3. Coluna para rastrear notificação ao coordinator (usada pelo dispatcher)
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS coordinator_notified_at timestamptz;

-- 4. Índice para fila de aprovação
CREATE INDEX IF NOT EXISTS idx_announcements_pending
  ON announcements(status) WHERE status = 'pending_approval';
```

### Máquina de estados

```
coordinator cria  →  pending_approval  →  (director aprova)  →  scheduled  →  sending  →  sent
                                       →  (director rejeita) →  rejected

director cria     →  scheduled  →  sending  →  sent   (bypass automático)
```

O broadcaster já ignora tudo fora de `scheduled/sending` — zero mudanças necessárias.

### RLS

Nenhuma nova policy necessária. A transição `pending_approval → scheduled/rejected` ocorre via engine (Node.js com service role ou via `set_config` + função privilegiada), não diretamente pelo cliente PWA.

Para aprovação via PWA: o cliente chama `supabase.rpc('set_config', ...)` + UPDATE com `reviewed_by = collaborator.id`. A policy existente em `announcements` (authenticated pode ler; escrita só via engine) precisa ser verificada — se necessário, adicionar policy específica para UPDATE de `status/reviewed_by/rejection_reason` para director.

---

## Seção 2: Fluxo TOM

### Coordinator cria comunicado

Sem mudança no marker `<<ANNOUNCEMENT_ACTION>>`. A mudança é no `applyAnnouncementAction`:

```js
// engine.js — applyAnnouncementAction (modificar trecho existente)
const isCoordinator = collaborator.role === 'coordinator';
const initialStatus = isCoordinator ? 'pending_approval' : 'scheduled';

// INSERT announcements com status = initialStatus
// ...

if (isCoordinator) {
  // Buscar todos os directors com phone
  const { data: directors } = await supabase
    .from('collaborators')
    .select('id, full_name, phone')
    .eq('role', 'director')
    .not('phone', 'is', null);

  const shortId = ann.id.slice(0, 4);
  const audienceStr = buildAudienceLabel(parsed.audience); // helper existente
  const bodyPreview = parsed.body.slice(0, 80) + (parsed.body.length > 80 ? '...' : '');

  for (const director of directors ?? []) {
    await whatsapp.sendMessage(director.phone, [
      `📋 *Comunicado pendente de aprovação*`,
      `De: ${collaborator.full_name} (coordinator)`,
      `Para: ${audienceStr}`,
      `Mensagem: "${bodyPreview}"`,
      `ID: \`${shortId}\``,
      `Responda: APROVAR ${shortId} ou REJEITAR ${shortId} [motivo opcional]`,
    ].join('\n'));
  }

  return `Comunicado criado e enviado para aprovação dos diretores. ID: ${shortId}`;
}
```

Se não houver directors cadastrados com phone, engine loga aviso e retorna mensagem ao coordinator informando que o comunicado aguarda aprovação manual no PWA.

### Director aprova/rejeita via TOM

TOM detecta padrão natural ("APROVAR abc1", "REJEITAR abc1 texto muito longo") e emite marker:

```
<<ANNOUNCEMENT_APPROVAL>>
{"action": "approve", "announcement_id": "abc1"}
<<END>>

<<ANNOUNCEMENT_APPROVAL>>
{"action": "reject", "announcement_id": "abc1", "reason": "texto muito longo"}
<<END>>
```

### `parseAnnouncementApprovalMarker(text)`

```js
// Regex para detectar o marker
const m = text.match(/<<ANNOUNCEMENT_APPROVAL>>\s*([\s\S]*?)\s*<<END>>/i);
if (!m) return null;
const parsed = JSON.parse(m[1]);
// Validar: action IN ('approve','reject'), announcement_id string não vazia
return parsed;
```

### `applyAnnouncementApproval(director, parsed)`

```js
async function applyAnnouncementApproval(director, parsed) {
  // Só directors podem aprovar/rejeitar
  if (director.role !== 'director') {
    return 'Apenas diretores podem aprovar ou rejeitar comunicados.';
  }

  // Buscar announcement por short ID ou UUID completo
  const idFilter = parsed.announcement_id.length === 4
    ? supabase.from('announcements').select('*').filter('id::text', 'ilike', `${parsed.announcement_id}%`)
    : supabase.from('announcements').select('*').eq('id', parsed.announcement_id);

  const { data: rows } = await idFilter
    .eq('status', 'pending_approval')
    .order('created_at', { ascending: false })
    .limit(1);

  if (!rows?.length) {
    return 'Comunicado não encontrado ou não está mais pendente de aprovação.';
  }

  const ann = rows[0];

  // Bloquear auto-aprovação
  if (ann.created_by === director.id) {
    return 'Você não pode aprovar seu próprio comunicado.';
  }

  if (parsed.action === 'approve') {
    await supabase.from('announcements')
      .update({ status: 'scheduled', reviewed_by: director.id })
      .eq('id', ann.id);

    // Notificar coordinator
    const { data: coordinator } = await supabase
      .from('collaborators').select('phone, full_name').eq('id', ann.created_by).single();
    if (coordinator?.phone) {
      await whatsapp.sendMessage(coordinator.phone,
        `✅ Seu comunicado foi aprovado por ${director.full_name} e será enviado em breve.`);
    }
    return `Comunicado ${parsed.announcement_id} aprovado com sucesso.`;
  }

  if (parsed.action === 'reject') {
    const reason = parsed.reason ?? null;
    await supabase.from('announcements')
      .update({ status: 'rejected', reviewed_by: director.id, rejection_reason: reason })
      .eq('id', ann.id);

    const { data: coordinator } = await supabase
      .from('collaborators').select('phone, full_name').eq('id', ann.created_by).single();
    if (coordinator?.phone) {
      const motivo = reason ? `Motivo: "${reason}"` : 'Sem motivo informado.';
      await whatsapp.sendMessage(coordinator.phone,
        `❌ Seu comunicado foi rejeitado por ${director.full_name}. ${motivo}`);
    }
    return `Comunicado ${parsed.announcement_id} rejeitado.`;
  }
}
```

### Integração no pipeline `processMessage`

Após o bloco `ANNOUNCEMENT_ACTION`, adicionar:

```js
const approvalMarker = parseAnnouncementApprovalMarker(assistantText);
if (approvalMarker) {
  const result = await applyAnnouncementApproval(collaborator, approvalMarker);
  // Não re-processa — resultado já é string de confirmação
}
```

### Skill TOM (`skills/aprovacao-comunicados.md`)

Carregada para `director` e `coordinator`. Cobre:
- Coordinator: informa que comunicado foi enviado para aprovação; como consultar pendentes
- Director: reconhece `APROVAR <id>` / `REJEITAR <id> [motivo]`; como listar pendentes ("quais comunicados aguardam aprovação?")
- TOM lista pendentes com: ID curto, autor, audiência, corpo truncado, data de criação

---

## Seção 3: PWA — Tela de Observabilidade

### Arquivos

```
web/src/
├── screens/
│   └── Observabilidade.tsx     # tela principal
└── components/
    └── AprovacaoSheet.tsx      # sheet de rejeição com campo de motivo opcional
```

### `Mais.tsx` — novo item

```ts
{ to: '/mais/observabilidade', label: 'Observabilidade', hint: 'Aprovações e métricas de envio', requireRoles: ['director', 'coordinator'] }
```

### `App.tsx` — nova route

```tsx
<Route path="mais/observabilidade" element={<Observabilidade />} />
```

### `Observabilidade.tsx` — estrutura

**Query principal:**
```sql
SELECT
  a.*,
  c.full_name AS author_name,
  COUNT(j.id) FILTER (WHERE j.status = 'sent') AS jobs_sent,
  COUNT(j.id) FILTER (WHERE j.status = 'failed') AS jobs_failed,
  COUNT(j.id) FILTER (WHERE j.status = 'cancelled') AS jobs_cancelled,
  COUNT(j.id) FILTER (WHERE j.status = 'pending') AS jobs_pending,
  COUNT(j.id) AS jobs_total
FROM announcements a
LEFT JOIN collaborators c ON c.id = a.created_by
LEFT JOIN announcement_jobs j ON j.announcement_id = a.id
WHERE a.created_at >= now() - interval '30 days'
GROUP BY a.id, c.full_name
ORDER BY a.created_at DESC
```

Via Supabase JS:
```ts
supabase
  .from('announcements')
  .select(`
    *,
    author:collaborators!created_by(full_name),
    jobs:announcement_jobs(status)
  `)
  .gte('created_at', thirtyDaysAgo)
  .order('created_at', { ascending: false })
```

**Bloco 1 — Fila de aprovação** (`status = 'pending_approval'`)
- Cards ordenados por `created_at ASC` (mais antigo primeiro)
- Cada card: corpo truncado (120 chars) · público (`audienceLabel()`) · autor · "há X min/h"
- Director: botão ✅ Aprovar (mutação direta) + botão ❌ Rejeitar (abre `AprovacaoSheet`)
- Coordinator: badge "Aguardando aprovação" (sem botões de ação)
- Se vazio: texto "Nenhum comunicado aguardando aprovação"

**Bloco 2 — Fila ao vivo** (`status IN ('sending', 'scheduled')`)
- `sending`: "X de Y enviados" com barra de progresso simples
- `scheduled`: data/hora de agendamento + audiência
- Se vazio: ocultar o bloco

**Bloco 3 — Histórico recente** (últimos 30 dias, todos os status)
- Lista compacta: status badge · audiência · `X env / Y falh / Z canc` · data
- Status `rejected`: mostra `rejection_reason` em itálico se houver

**Bloco 4 — Alerta de duplicidade**
- Detectado no cliente: se 2+ announcements com `status IN ('pending_approval','scheduled','sending')` + audiência sobreponível + mesmo dia
- Audiências sobreponível = qualquer um tem `all: true`, ou têm `function_role`/`unidade` em comum
- Banner amarelo no topo: "⚠️ Atenção: há X comunicados ativos para o mesmo público hoje"
- Não bloqueia ação alguma

### `AprovacaoSheet.tsx`

Props: `open`, `onClose`, `announcement`, `onConfirm(reason: string | null)`

- Campo `<textarea>` opcional: "Motivo da rejeição (opcional)"
- Botão "Confirmar rejeição" → chama `onConfirm(reason || null)`
- Mutação no parent (`Observabilidade.tsx`): UPDATE `status='rejected'`, `reviewed_by`, `rejection_reason`; depois notifica coordinator via RPC ou edge function

**Notificação ao coordinator via PWA:** o cliente PWA não tem acesso ao WhatsApp. Mecanismo: o dispatcher cron (já existente) detecta announcements onde `status IN ('scheduled','rejected') AND reviewed_by IS NOT NULL AND coordinator_notified_at IS NULL`, envia o WhatsApp para o coordinator, e seta `coordinator_notified_at = now()`. Reutiliza o padrão do broadcaster — sem Edge Function nova, sem infraestrutura adicional.

Função nova em `dispatcher.js`: `notifyCoordinators(whatsapp)` — chamada no `run()` a cada tick, antes de `dispatchAnnouncements`.

---

## Seção 4: Error Handling & Edge Cases

| Cenário | Comportamento |
|---|---|
| Director aprova comunicado já aprovado por outro | Engine: "Comunicado não está mais pendente de aprovação" |
| Director rejeita comunicado já rejeitado | Mesmo erro silencioso acima |
| Coordinator tenta aprovar o próprio comunicado | Engine bloqueia: `created_by === director.id` → "Você não pode aprovar seu próprio comunicado" |
| ID curto ambíguo (2+ UUIDs com mesmo prefixo em `pending_approval`) | Engine usa o mais recente (`ORDER BY created_at DESC LIMIT 1`) + responde com shortId confirmado |
| Nenhum director com phone cadastrado | Engine loga aviso; comunicado fica em `pending_approval`; coordinator instruído a usar PWA |
| Comunicado aprovado mas audiência sem destinatários | Broadcaster já trata: `status = sent` automaticamente |
| Coordinator cria via PWA | Mesmo fluxo: `status = pending_approval`, notificação WhatsApp para directors via Edge Function |
| Director aprova via PWA | UPDATE direto + Edge Function notifica coordinator (sem marker) |
| Rejeição sem motivo | `rejection_reason = null`; coordinator recebe "rejeitado sem motivo informado" |
| Comunicado em `sending` quando director tenta rejeitar | Impossível — `sending` nunca passa por `pending_approval` (directors têm bypass) |

---

## Fora de escopo (Fatia 4+)

- Gráfico temporal de envios por dia/semana
- Coordinator pede reenvio de comunicado rejeitado (edição — hoje é criar novo)
- Aprovação para eventos institucionais
- TOM responde queries de observabilidade ("quantos comunicados enviados essa semana?")
- Push notifications PWA para directors quando chega comunicado pendente
