# Secret Rotation Runbook

Procedimento para rotacionar `SUPABASE_SERVICE_ROLE_KEY` e `UAZAPI_TOKEN` quando vazaram (ou periodicamente, como hygiene).

---

## Estado em 28/04/2026 (Sprint 4)

**Veredicto:** runbook **fechado e operacional**. Nenhuma ação pendente do lado do agente. Próxima rotação só precisa ser executada manualmente quando: (a) hygiene de 90 dias bater, (b) suspeita de novo vazamento, ou (c) `WEBHOOK_SECRET` for ativado (fora desta sprint).

**Snapshot atual (linha de base para a próxima execução):**

| Variável | sha256 (12) | length | Estado |
|---|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `9449de095236` | 219 | rotacionado anteriormente |
| `UAZAPI_TOKEN` | `8f75f8571b1f` | 36 | rotacionado anteriormente |
| `OPENAI_API_KEY` | `35a73055ccf7` | 164 | em uso (Whisper) |
| `ANTHROPIC_API_KEY` | — | 0 | vazio (TOM usa Claude CLI — OK por design) |
| `WEBHOOK_SECRET` | — | 0 | vazio (HMAC do webhook UAZAPI ainda não ativado) |

**Validações automáticas confirmadas hoje:**
- `/opt/LA-Organizer/.env` perms = 600 ✅
- `scripts/validate-rotation.sh` presente na VPS ✅
- 16/16 invariantes RLS verdes em `scripts/rls-test.js` ✅
- 0 policies leaky (`pg_policies WHERE qual='true' AND public=ANY(roles)`) ✅

**Por que o agente não executou rotação:** exige acesso a dashboard Supabase + painel UAZAPI (operação humana fora do shell). O runbook abaixo é canônico — nada a automatizar sem manipular segredos.

---

## Quando aplicar

- Suspeita ou evidência de vazamento (commit acidental, log, screenshot público)
- Resposta a incidente de segurança
- Hygiene periódica (recomendado: 90 dias)

## Pré-requisitos

- Acesso ao painel Supabase do projeto
- Acesso ao painel UAZAPI (instância LA Organizer (Tom))
- SSH no VPS `tom`
- Permissão pra reload do PM2

## Snapshot pré-rotação

Antes de qualquer mudança, capturar fingerprints atuais (sha256 dos valores) — sem expor o valor:

```bash
ssh tom 'cd /opt/LA-Organizer && \
  awk -F= "/^SUPABASE_SERVICE_ROLE_KEY|^UAZAPI_TOKEN/ {printf \"%s: \", \$1; print \$2 | \"sha256sum\"}" .env'
```

Anotar os 12 primeiros caracteres do hash. Após rotação, esses hashes devem ser DIFERENTES.

## Bloco 1 — Supabase service_role key

### Passo 1.1 — Rotacionar no dashboard

1. Acessar `https://supabase.com/dashboard/project/cesnbnrynvxvgdhfmaua/settings/api`
2. Na seção **Project API keys**, localizar `service_role` (✅ **NUNCA** exponha; é a chave que bypassa RLS)
3. Clicar em **Reset secret** (ou similar — a UI da Supabase pode mudar)
4. Confirmar a operação. **Atenção**: a chave antiga é invalidada IMEDIATAMENTE; o TOM em produção vai parar de funcionar até atualizar `.env`.
5. Copiar a NOVA chave (começa com `eyJ...`)

### Passo 1.2 — Atualizar VPS

```bash
ssh tom 'nano /opt/LA-Organizer/.env'
# Substituir a linha SUPABASE_SERVICE_ROLE_KEY=... pela nova
# Salvar (Ctrl+O, Enter) e sair (Ctrl+X)
```

Garantir permissão 600:

```bash
ssh tom 'chmod 600 /opt/LA-Organizer/.env && ls -la /opt/LA-Organizer/.env'
```

### Passo 1.3 — Reiniciar TOM

```bash
ssh tom 'pm2 reload tom'
```

### Passo 1.4 — Validar

```bash
ssh tom 'cd /opt/LA-Organizer && bash scripts/validate-rotation.sh'
```

Verificar saída:
- `[3] Supabase: read test ... HTTP 200`
- `[4] Supabase: write test ... INSERT/DELETE ok`
- `[5] Supabase: ritual_logs read ... rows: 3`

## Bloco 2 — UAZAPI token

### Passo 2.1 — Rotacionar no painel UAZAPI

1. Login no painel da UAZAPI
2. Localizar a instância **LA Organizer (Tom)** (id `r19b49704ae63ef`)
3. Clicar em **Regenerate token** (ou similar)
4. **Atenção**: o token antigo é invalidado imediatamente. WhatsApp para de receber/enviar até atualizar `.env`.
5. Copiar o NOVO token

### Passo 2.2 — Atualizar VPS

```bash
ssh tom 'nano /opt/LA-Organizer/.env'
# Substituir UAZAPI_TOKEN=... pela nova
```

### Passo 2.3 — Reiniciar TOM

```bash
ssh tom 'pm2 reload tom'
```

### Passo 2.4 — Validar

```bash
ssh tom 'cd /opt/LA-Organizer && bash scripts/validate-rotation.sh'
```

Verificar:
- `[6] UAZAPI: instance/status ... HTTP 200`
- `instance.status = connected`

### Passo 2.5 — Smoke test envio real

Mandar uma mensagem de teste de outro número pro TOM (ou pra você mesmo via webhook simulado). Verificar que a resposta chega.

## Bloco 3 — Validação ponta a ponta

Depois das duas rotações:

1. **TOM sobe sem erro**:
   ```bash
   ssh tom 'pm2 logs tom --lines 20 --nostream | grep -E "PROCESS START|ERR|fatal"'
   ```
   Esperado: `PROCESS START` recente, sem ERR/fatal.

2. **Mensagem in/out via WhatsApp**: testar com seu próprio número.

3. **Marker funcionando**: enviar uma mensagem que dispara TASK_UPDATE; verificar:
   ```sql
   SELECT * FROM marker_logs WHERE marker_type='TASK_UPDATE'
     ORDER BY created_at DESC LIMIT 3;
   ```

4. **Cron/dispatcher funcionando**: aguardar próximo tick (até 5 min) ou forçar:
   ```bash
   ssh tom 'cd /opt/LA-Organizer && node src/rituals/dispatcher.js --phone=5521981278047'
   ```

5. **Logs sem segredos**:
   ```bash
   ssh tom 'pm2 logs tom --lines 1000 --nostream 2>&1 | grep -ciE "eyJ[A-Za-z0-9_-]{30,}|sb_secret_"'
   ```
   Esperado: 0.

6. **Hashes confirmam rotação**:
   ```bash
   ssh tom 'cd /opt/LA-Organizer && \
     awk -F= "/^SUPABASE_SERVICE_ROLE_KEY|^UAZAPI_TOKEN/ {printf \"%s: \", \$1; print \$2 | \"sha256sum\"}" .env'
   ```
   Comparar com snapshot pré-rotação — DEVEM ser diferentes.

## Riscos encerrados após rotação

- ✅ Chaves do commit `3ad52f5` deixam de ter validade
- ✅ Repositório público com chaves antigas no histórico não dá mais acesso
- ✅ Eventual leak em screenshot/log antigo do `.env` fica neutralizado

## Pendências que NÃO são resolvidas pela rotação

- ⏳ Histórico do git ainda contém o commit `3ad52f5` (chaves inutilizáveis, mas é hygiene removê-las)
- ⏳ Repo continua público (decisão do dono)
- ⏳ `WEBHOOK_SECRET` continua vazio — webhook não é HMAC-verificado (separado desta sprint)

## Checklist final

- [ ] Snapshot pré-rotação capturado
- [ ] Supabase service_role rotacionado no dashboard
- [ ] `.env` na VPS atualizado com nova chave Supabase
- [ ] PM2 reload — `[1.4]` validado
- [ ] UAZAPI token rotacionado no painel
- [ ] `.env` na VPS atualizado com novo token
- [ ] PM2 reload — `[2.4]` validado
- [ ] Bloco 3 ponta-a-ponta OK
- [ ] Hashes pós-rotação ≠ hashes pré-rotação
- [ ] Sem segredos em logs/marker_logs/ritual_logs
- [ ] `.env` perms = 600
- [ ] Documentado em commit (sem expor valores)

## Política de não-vazamento

Em logs, docs, mensagens de chat, ou commits:
- ❌ Nunca colar o valor inteiro de uma chave
- ✅ Sempre máscara: `eyJ123...XYZ4 (len=N, sha256=12chars)`
- ✅ Hash sha256 truncado é seguro pra evidência de "valor mudou"
- ✅ HTTP code é seguro pra evidência de "credencial autentica"
