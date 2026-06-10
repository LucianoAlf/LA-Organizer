# Auditoria — conversa Rose × TOM (09–10/06/2026)

> Workflow ultracode 10/06: 28 agentes, 6 coletores + triagem + veredito adversarial (2 lentes nos graves).
> Vereditos brutos com evidência completa: `2026-06-10-rose-verdicts-raw.txt` (mesma pasta).
> Rose = 8bfb18b6-3c2e-4579-b4a9-06409d7e84c4 (manager financeiro, sem horário fixo — bebê pequeno).

## Placar (12 itens, todos confiança ALTA)

| # | Item | Veredito |
|---|------|----------|
| R01 | Pedido 18:44 ("me envia a msg de lembrete da reunião 14h") sem resposta | **BUG** — msg perdida no restart do deploy (SIGINT 21:45:04; in-flight não persiste). Vítima colateral: Ana Paula. |
| R02 | "Não tenho a lista de convidados" (20:46) com 5/7 confirmados no banco | **GAP** — prompt do dono de evento não inclui event_participants (system.js:1385). |
| R03 | Repasses "✅ X confirmou (N/7)" não gravados em conversation_history | **BUG** — RSVP-NOTIFY-OWNER (engine.js:2935) manda WhatsApp sem logar → LLM cego (alimenta R02). |
| R04 | Anotação "Reunião com ADMS" | **PARCIAL** — salva DE VERDADE em collaborator_memory 0080ea63 (íntegra); TOM recupera via chat; **invisível no app** (RLS de leitura própria já existe, falta UI). |
| R05 | "Amanhã às 9h te cobro" (Matheus/emusys) | **BUG** — dito à 00:57, "amanhã" virou 11/06 (D+1 calendário); briefing prometeu hoje 9h. **Reparado**: task 88187136 → due 10/06, remind 9h BRT. Fix raiz: semântica madrugada no auto-align. |
| R06 | "Feito! Tirei o briefing das 8h e o fechamento das 19h" | **FABULAÇÃO** — PREFS_UPDATE {null,null} REJEITADO (schema_invalid; HHMM_RE não aceita null, engine.js:3739); briefing disparou hoje 08:12. Não existe forma de desligar ritual (dispatcher.js:3374 fallback '07:00'). Falha silenciosa: rejeição não corrige o "Feito". |
| R07 | "Sempre pergunto antes de mandar áudio" | **GAP** — memória salva 3×, mas shouldSendVoice não lê memória; voice_enabled segue true; promessa sem mecanismo. |
| R08 | "Saving the audio preference to local memory." em inglês no WhatsApp | **BUG** — narração pós-marker; sanitizer (claude.js regra 4 + engine.js:9497) não casa o padrão. |
| R09 | Áudio espontâneo 00:59 sem perguntar | **BUG** — gatilho celebration falso-positivo: "parabéns" (pelo bebê) em resposta biográfica + dado 70% (shouldSendVoice.js:84-89). Gatilho segue vivo (2 disparos hoje). Bônus: histórico só guarda slice(0,200) do áudio. |
| R10 | Lembretes Geraldo 23:55 e 00:00 (task vencida 05/06) | **BUG** — Rose criou task retroativa via PWA 23:54; reminders nasceram com remind_at no PASSADO e dispararam no tick seguinte, de madrugada. Sem guard de staleness (dispatcher.js:4719+), sem gate noturno default (quiet_* da Rose tudo null). Latente: nowSaoPaulo() devolve hour=24 à meia-noite na VPS (sem hourCycle h23). |
| R11 | Briefing lista "Conciliação Bancária" 2× + remind_at que ela não pediu | **BUG** duplo — (a) materializer inclui o dia do próprio template (materialize-recurrence.ts:48 + recurrence-engine.js:89, dedupe não olha due_date do pai); (b) hint "Emita o marker AGORA" do auto-resolve de intent sem alvo restrito → LLM reagendou as 2 Conciliações sozinho. **Reparado**: remind_at limpo nas 2. Duplicata 407a56e2 aguarda OK p/ excluir. |
| R12 | "Não tenho horário de trabalho" reconhecido | **FABULAÇÃO/GAP** — nenhuma proteção configurada: quiet_* tudo null; TOM nunca emitiu quiet_start/end (o marker JÁ suporta, inclusive null); memória de 06:13 não gateia dispatcher. |

## Reparos de dados executados em 10/06 (~08:35 BRT)
1. Task Matheus 88187136: due_date 2026-06-10, remind_at 2026-06-10 12:00Z (9h BRT hoje) — como Rose pediu e o briefing prometeu.
2. Conciliação 907f62e3 + 407a56e2: remind_at→NULL (escrita espúria do LLM às 01:03 revertida).
3. PENDENTE (precisa OK por ser deleção): excluir filha duplicada 407a56e2 (mesma due_date do template).

## Plano de correção (3 fatias)

### Fatia 1 — Honestidade do "Feito" + anti-madrugada (urgente, desbloqueia a Rose)
1. PREFS_UPDATE aceita `null` em briefing_time/closing_time (engine.js:3739-42) + dispatcher respeita null explícito (3374: sem fallback '07:00'; closing 3387 já meio pronto). Aplicar pra Rose.
2. PREFS_UPDATE rejected/malformed → injeta "_não consegui salvar a configuração_" na resposta (espelhar branch all_failed 8235). Mata o "Feito!" falso.
3. checkTaskReminders: guard de staleness — remind_at anterior ao created_at do reminder (ou >30min no passado ao nascer) → marca sent SEM enviar.
4. Gate noturno DEFAULT (00:00–07:00 BRT) p/ proativos quando quiet_* nulo — quiet por default, não spam por default.
5. nowSaoPaulo() com hourCycle:'h23' (mata hour=24).

### Fatia 2 — Contexto e histórico fiéis (mata a "cegueira" do LLM)
6. RSVP-NOTIFY-OWNER grava outbound em conversation_history (padrão dispatcher.js:4891). Idem outros sends diretos (códigos/PWA).
7. system.js eventos owned: embutir event_participants (FK explícita) + render "👥 5/7 confirmaram — aguardando: Gabi, Jhonatan".
8. Log do áudio completo (engine.js:9802 sem slice 200).
9. Sanitizer: regra EN ampliada p/ sav(e|ing)…memor(y|ória) intercalado + descartar trailing EN pós-<<END>>.

### Fatia 3 — Semântica e voz
10. "Amanhã" dito 00:00–04:59 BRT = dia civil corrente (auto-align engine.js:8138-47 + âncoras de prompt).
11. Voz: gate user_requested antes do curto-circuito (opt-out = nunca espontâneo, atende pedido); celebration exige contexto real (não "parabéns" de passagem + dado); skill emite voice_enabled:false p/ "me pergunta antes".
12. Shutdown: persistir mensagens in-flight na fila no timeout (shutdown.js:56-66 + Map de payloads em processamento).
13. Materializer: seed do dedupe com a due_date do template (2 arquivos); hint de intent confirmada restrito aos ids do payload.

Known issues a registrar APÓS cada fix: INFLIGHT-LOST-ON-RESTART, RSVP-HISTORY-MISSING, AMANHA-POS-MEIA-NOITE, PREFS-NULL-FEITO-FALSO, VOICE-CELEBRATION-FP, EN-LEAK-SANITIZER, REMINDER-STALE-PAST, RECUR-TEMPLATE-DUP, HOUR24-NOWSAOPAULO.

## Proposta de produto (a Rose desenhou o roadmap usando)
1. **Anotações no PWA** — ela ditou uma ata de reunião completa; está salva em collaborator_memory e a RLS de leitura própria JÁ existe. Falta só a tela. (Menor esforço, maior efeito-surpresa positivo.)
2. **Painel do evento pro dono via chat** — "falta quem confirmar?" responde na hora (fatia 2.7) + ação "manda lembrete pra quem não confirmou" (novo marker/ação de evento — ela pediu isso às 18:44).
3. **Modo "sem horário fixo"** — ver abaixo.

## Política "sem horário fixo" (Rose, Fabi, Jessica — mães de bebê)
Princípio: empresa humanizada = o TOM nunca puxa assunto fora de janela humana; quem decide o horário é ela.
- **Rituais de hora fixa**: OFF de verdade (fatia 1.1) — sob demanda ("me manda o briefing" funciona a qualquer hora).
- **Proativos** (lembretes de sistema, cobranças, digests): só 09:00–21:00 BRT; fora disso, segura e entrega no início da janela. Default global 00–07h bloqueado pra TODOS (fatia 1.4).
- **Lembretes que ELA pediu com hora explícita**: disparam na hora pedida, qualquer hora (pedido explícito > política).
- **Respostas**: sempre, a qualquer hora — quem abre conversa de madrugada é ela, nunca o TOM.
- Implementação: flag por colaborador (ex.: flexible_schedule) que o TOM seta via PREFS_UPDATE ao ouvir "não tenho horário"; skill instrui a oferecer a janela.
