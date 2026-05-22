# Skill: lembrete-prazo

## Quando usar

Acionar quando o usuário responder a um lembrete proativo de prazo de checkpoint mandado pelo TOM (via `runCheckProjectDeadlines` no dispatcher). A mensagem original tem o formato:

> 🟢 *Festival de Cordas 2026*
> Checkpoint: *Montar escala*
> 📅 Prazo em 3 dia(s): 25/05/2026
> Como tá o andamento?

E o usuário responde algo tipo:
- "tá quase pronto"
- "tô atrasado, ajuda"
- "já fiz, pode marcar"
- "esqueci, faço amanhã"
- "esse checkpoint não rola mais, cancela"

## Como identificar o checkpoint

Olhar o contexto recente (últimas 5 mensagens da conversa) — o nome do checkpoint estava na mensagem do TOM. Se não conseguir extrair, perguntar: "De qual checkpoint você tá falando? Tive vários abertos."

## Fluxo de reação

### "Já fiz" / "Tá pronto" / "Concluído"

Confirmar e marcar como done:

> "Boa! Marquei como concluído. ✅"

```sql
UPDATE project_checkpoints
SET status = 'done', completed_at = NOW()
WHERE id = '<cp_id>';
```

### "Tá quase" / "Quase lá" / "Esta semana sai"

Não cobrar de novo até o próximo marco (D0 ou D+1). Registrar nota em `tom_memories`:

```sql
INSERT INTO tom_memories (collaborator_id, memory_type, content, importance, expires_at)
VALUES ('<responsavel_id>', 'checkpoint_status',
        'Checkpoint <cp_id> ("<name>"): usuário disse que está quase. Não cobrar de novo até <next_marco>.',
        'medium', '<next_marco_date>');
```

Responder: "Beleza, vou ficar de olho. Te lembro só se passar do prazo."

### "Tô atrasado" / "Empacado" / "Não consigo"

Oferecer ajuda concreta:

> "Entendo. Quer que eu faça o quê?
> 1. Adia o prazo (pra quando?)
> 2. Cria uma task pra destravar — me diz o que tá travando
> 3. Reatribui pra outra pessoa do time
> 4. Cancela o checkpoint"

### "Cancela" / "Não rola mais"

Confirmar: "Tem certeza que quer cancelar esse checkpoint? Vou marcar como cancelado, não some — fica no histórico."

Se sim:
```sql
UPDATE project_checkpoints SET status = 'cancelled' WHERE id = '<cp_id>';
```

### "Esqueci" / "Vou ver amanhã"

Responder com leveza:

> "Tudo bem, acontece. Te lembro de novo amanhã."

Não criar memory — o próprio cron do D-1/D0 vai cobrar.

## Não fazer

- ❌ Não responder de forma genérica ("ok, anotado") — usuário não sabe o que foi anotado
- ❌ Não cancelar checkpoint sem confirmar
- ❌ Não tentar fazer múltiplas ações no mesmo turno (ex: marcar done + adiar — escolhe uma)
- ❌ Não cobrar de novo no mesmo dia (idempotência já garante isso no dispatcher, mas se o usuário responder e você precisar reabrir o assunto, espera o próximo marco)

## Espelhamento PWA

O usuário pode também marcar manualmente no app em `/projetos/<id>` aba Checkpoints. O cron do TOM e a UI escrevem na mesma tabela, então mudanças refletem dos dois lados.
