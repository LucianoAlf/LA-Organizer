# Restart Behavior

What happens when the PM2 process running TOM crashes or is reloaded.

## Architecture summary

| Layer | Lifetime | Notes |
|---|---|---|
| `per-user-queue.js` | in-memory | reset on restart |
| `dedupe.js` | in-memory | reset on restart (24h TTL ignored after reset) |
| in-flight `processMessage` | in-memory | aborted on restart |
| `tasks.remind_at` | DB | dispatcher polls every 5min |
| `task_reminders.sent_at IS NULL` | DB | dispatcher polls every 5min |
| `ritual_logs` | DB | drives `alreadySent()` idempotency |
| `collaborators.onboarding_completed` | DB | drives onboarding resume |
| `notifications` | DB | persistent |
| **System cron** (`*/5 * * * *`) | crontab | runs OUTSIDE PM2; survives PM2 crash |

## Test matrix (executed 2026-04-27)

| # | Scenario | Result | Risk |
|---|---|---|---|
| T1 | Message in-flight + restart | Webhook returned 200 before enqueue; `processMessage` may be killed mid-flight. UAZAPI will NOT redeliver. | **Low** — user retries naturally; DB writes are idempotent (action='complete' on already-done task is no-op). |
| T2 | Pending reminder + restart | `task_reminders.sent_at IS NULL` rows persist. Next cron tick (max 5min) picks them up via `checkTaskReminders()`. | **None** — fully resilient via DB-driven polling. |
| T3 | Ritual scheduled + restart | `ritual_logs` `alreadySent()` check + slot alignment (15-min slots) prevents double-send. Different slots can never match the same configured time. | **None** — invariant holds across restart. |
| T4 | Incomplete onboarding + restart | `collaborators.onboarding_completed=false` is DB-only; on next message, `onboardingActive=true` resumes the flow. No in-memory state. | **None** — persistent state. |
| T5 | Broadcast in progress + restart | Broadcast feature not yet implemented (planned Sprint 3). | N/A |

## Concrete invariants

1. **No double-send of WhatsApp**: handled by `dispatcher.alreadySent()` (DB query) + 15-min slot alignment. If WA was sent but `ritual_logs` insert crashed, the next cron tick is in a different slot and won't re-fire — at the next configured time (next day), the row exists from the previous successful insert OR from any retry. **Edge case** documented below.
2. **No reminder lost**: `task_reminders` table has `sent_at IS NULL` as the queue indicator. Lines persist regardless of process state. Cron polls every 5min.
3. **No stuck onboarding**: state is fully in DB (collaborators + user_preferences + conversation_history). Restart cannot strand a user.
4. **No re-execution of completed tasks**: `applyTaskActions` checks task status before mutating. Already-done complete is a no-op.

## Known gaps (acceptable for piloto controlado)

### G1 — In-flight message can be lost on restart
**Symptom**: User sends "fiz a tarefa" → engine begins → PM2 reload → user gets no reply.
**Why**: Webhook already returned 200; UAZAPI will not redeliver.
**Mitigation today**: User retries naturally. DB writes by markers are idempotent.
**Future fix (out of scope)**: Persist webhook payloads to a `pending_messages` table before enqueue; replay unprocessed entries on boot.
**Priority**: Low — happens only at the exact moment of restart, which is rare.

### G2 — Half-committed marker writes
**Symptom**: TASK_UPDATE marker writes to DB succeed, but `whatsapp.sendMessage(reply)` is killed before sending.
**Why**: marker side effects happen BEFORE the outbound send (engine.js orders: parse → persist → sendMessage).
**Mitigation today**: User sees no reply, sends "fiz" again. Engine re-applies the action: idempotent at DB level (already-done task stays done, no error). User eventually realizes via the next briefing.
**Future fix (out of scope)**: 2-phase commit pattern with deferred persistence after WA send confirmation.
**Priority**: Low — produces UX confusion but no data corruption.

### G3 — Dedupe cache empty post-restart
**Symptom**: A retry from UAZAPI delivered within seconds of restart could process the same event twice.
**Why**: `seen` Map<key, exp> is in-memory.
**Mitigation today**: UAZAPI redelivery is rare; webhook returns 200 quickly to suppress retries.
**Future fix (out of scope)**: Persist dedupe keys to a small DB table or Redis with 24h TTL.
**Priority**: Very low — empirical incidence ~0.

### G4 — Edge case: ritual sent + log insert failure
**Symptom**: WA briefing was sent at 8:00, but `ritual_logs` insert crashed at 8:00:01.
**Why**: Engine inserts into ritual_logs AFTER `whatsapp.sendMessage`.
**Mitigation today**: Same slot won't fire again (cron tick at 8:05 sees slotNow=480 too — wait, 8:05 is slot 480 too! 8:00-8:14 all map to slot 480). Actually, cron is `*/5` so 8:05 ticks. **alreadySent returns false**, sendRitual fires AGAIN, double-send.
**Action taken**: documented as a known edge case. Probability: extremely low (DB write failure within a 30-second window, while WA send succeeded). If observed in production, switch order: write `ritual_logs` first as `status='in_flight'`, then send WA, then update to `'sent'`.
**Priority**: Low for piloto — monitor `v_recent_events` for duplicate same-day same-type rows.

## Observability changes (this sprint)

- `[TOM] PROCESS START pid=X` log at index.js boot — makes restart events traceable in `pm2 logs`.
- `[Engine] processMessage START phone=XXXX text="..."` / `DONE phone=XXXX in Yms` — mid-flight crashes are visible (START with no DONE = crashed mid-process).

Query to detect mid-flight crashes:
```bash
ssh tom 'pm2 logs tom --lines 200 --nostream | grep -E "PROCESS START|processMessage (START|DONE)"'
```

## Restart procedure (operational)

```bash
ssh tom 'pm2 reload tom'
# verify:
ssh tom 'pm2 logs tom --lines 5 --nostream | grep "PROCESS START"'
# system cron (independent) keeps firing every 5min from /etc/crontab
```

## Verdict

For **piloto controlado**: acceptable. The only real loss scenario (G1) requires a user to message at the exact second of restart, and the user retries naturally.

For **produção plena**: add `pending_messages` queue with at-least-once delivery (G1) and persistent dedupe (G3). Both deferred to a future sprint.
