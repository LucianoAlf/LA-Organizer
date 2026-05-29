# Relatório — Sprint 31.6 (Auditoria TOM 29/05)

**Data:** 29/05/2026
**Origem:** relatório de auditoria diária das 07:00 (5 alertas + 3 promessas sem persistência).
**Método:** cada item investigado na RAIZ com evidência real (marker_logs + logs VPS + estado do
banco) ANTES de corrigir; cada fix testado isolado e deployado separadamente.

---

## Itens corrigidos (10/10)

| # | Item | Raiz | Fix | Validação |
|---|------|------|-----|-----------|
| B1 | EVENT_UPDATE não editava evento | `VALID_EVENT_UPDATE_ACTIONS` só tinha reschedule/cancel/complete; `action:"update"` (título/notas/local/participante) era rejeitado | Adicionado `update` (engine + skill criar-compromisso.md); `notes`→`description` | 7/7 testes de validação |
| B2 | Dup-task agressivo em "Tarefa — Nome" | `stripSuffix` removia o sufixo "— Renan" antes de comparar → títulos viravam idênticos | Sufixos distintos após "—" ⇒ não bloqueia (rebaixa probable→possible) | 6/6 testes |
| D1 | "17/26 vencidas sem cobrança" | **Artefato de medição**: health-check rodava 07:00 (antes do chaser das 08:13) e contava TODAS as vencidas, mas o chaser só cobre 1-5d por design (6+ vão p/ CEO report) | Métrica escopada a 1-5d + lookback 48h | Simulado no banco: 0 sem cobrança |
| B5 | Coordination "avisa a Diana" falha silenciosa | Falha só era mostrada com 2+ destinatários; com 1, o texto otimista do LLM prevalecia | Superficia falha de 1 destinatário com msg específica do handler | Lógica confirmada |
| C1 | ACTIONABLE_NO_MARKER inflado | Detector marcava perguntas e auto-relato do user ("estou verificando", "eu já criei") como ação não-persistida | Exclui pergunta + auto-relato; `replyHasPromise` sempre conta | 8/8 testes |
| B3 | HABIT_ACTION schema_invalid | Validador exigia `name`/`habit_id`; TOM mandava `title`/`habit_slug` | Parser normaliza `title`→`name`, `habit_slug`→`habit_name` | Sintaxe ok |
| B4 | STICKER como UNKNOWN_MARKER | **Feature já existia e funciona** (envio via sendMedia type:'sticker'); só faltava o parser remover o marker → catch-all logava como desconhecido | Parser remove o marker (igual REACT) | Envio testado ao vivo (sticker chegou no WhatsApp do Alf) |
| D3 | Admin (conta de sistema) na métrica | `checkSilentCollaborators` não filtrava contas de sistema (Admin tem phone `00000000000`) | Ignora contas de sistema (nome conhecido OU phone só de zeros) | Lógica confirmada |
| E2 | Reschedule de tarefa delegada falhava | Lookup escopado a `assigned_to`; tarefa "Lembrar Kailane" é criada pela Krissya (delegadora) e atribuída ao Arthur → não achava | Lookup + update por `assigned_to` **OU** `created_by`; delegador remarca e **avisa o executor**; msg clara p/ quem não é dono | Validado no banco (task delegada remarcada) |
| D2 | "[Realtime] Erro de canal: undefined" 8x/dia | `CHANNEL_ERROR` logava `err` cru (vem undefined em queda transitória) com `console.error` | Mensagem com detalhe real + downgrade p/ `warn` (sai do error log). Sem reconexão manual (supabase-js já reconecta) | Sintaxe ok |

### Fixes do mesmo dia, anteriores à auditoria
- **Dup-bypass "2" travando** (constraint `tasks_source_check`): bypass usava `source:'tom'` (inválido) → trocado p/ `'manual'`. Bug antigo desde Sprint 23.5.
- **Áudio não baixava** (Krissya): `downloadFromUazapi` sem retry → falha transitória da CDN. Adicionado retry com backoff (beneficia áudio + imagem + vídeo).

---

## Arquivos tocados
- `src/engine.js` — B1, B2, B5, C1, B3, B4, E2 (+ dup-bypass source fix)
- `src/services/audio.js` — retry de download
- `src/services/whatsapp.js` — (revertido; sticker usa sendMedia existente)
- `src/webhook.js` — mensagem `download_failed`
- `src/rituals/health-check.js` — D1, D3
- `src/realtime/tom-realtime.js` — D2
- `skills/criar-compromisso.md` — B1 (action update)

## Padrões/aprendizados
1. **2 dos "bugs" eram infra que já existia** (D1 cobrança, B4 sticker) — confirmar antes de codar evitou trabalho duplicado.
2. **1 fix foi um chute que falhou** (1ª tentativa do dup-bypass: assumi FK sem ler o log; era CHECK constraint). Lição reforçada: SEMPRE ler o erro real primeiro.
3. **Contexto do usuário mudou um fix** (E2: ia bloquear o delegador; o Alf esclareceu que é fluxo de delegação → delegador deve poder remarcar).

## Estado final
- 10/10 itens deployados (pm2 restart #201). Auditoria de amanhã 07:00 deve refletir os números limpos.
