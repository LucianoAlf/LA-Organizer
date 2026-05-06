# Backup Automático Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurar backup diário automático do banco Supabase via pg_dump → VPS local (14d) + Google Drive (60d), rodando às 03h BRT.

**Architecture:** Shell script `/opt/LA-Organizer/backup.sh` chamado por crontab na VPS. O script carrega `DATABASE_URL` do `.env` existente, dumpa via `pg_dump`, comprime, rota local, e sync para Google Drive via rclone. Sem dependência da aplicação Node.js.

**Tech Stack:** bash, pg_dump (PostgreSQL client), rclone, crontab. VPS: host `tom` (SSH via `~/.ssh/tom_vps`), path `/opt/LA-Organizer`.

**Nota:** Não há git local neste projeto. Não há testes automatizados — validação é por verificação manual via SSH + DB.

---

## Task 1: Instalar rclone + configurar remote Google Drive

**Files:**
- Nenhum arquivo local — tudo na VPS interativamente via SSH

**Contexto:** rclone precisa ser configurado com OAuth do Google Drive numa sessão interativa (browser envolvido). Faça num terminal com acesso ao browser.

- [ ] **Step 1: SSH na VPS**

```bash
ssh -i ~/.ssh/tom_vps tom
```

- [ ] **Step 2: Verificar se rclone já está instalado**

```bash
rclone version
```

Se retornar versão: pule Step 3. Se `command not found`: continue.

- [ ] **Step 3: Instalar rclone (se necessário)**

```bash
curl https://rclone.org/install.sh | sudo bash
```

Verificar instalação:
```bash
rclone version
```

Expected: `rclone v1.6x.x` ou superior.

- [ ] **Step 4: Configurar remote gdrive**

```bash
rclone config
```

Siga o wizard interativamente:
```
No remotes found, make a new one?
n) New remote → escolha n

name> gdrive

Storage> drive         (digite "drive" ou o número correspondente a "Google Drive")

Google Application Client Id> (Enter — deixar vazio)
Google Application Client Secret> (Enter — deixar vazio)

scope> 1               (drive — Full access all files)

root_folder_id> (Enter — vazio)
service_account_file> (Enter — vazio)

Edit advanced config? n

Use auto config?
y) Yes (padrão) → escolha y

→ rclone vai abrir (ou exibir) uma URL. Abra no browser local, autorize com a conta Google do projeto.
→ Cole o código de verificação de volta no terminal.

Configure this as a Shared Drive (Team Drive)? n

Keep this remote? y → confirma
q → sair do config
```

- [ ] **Step 5: Verificar remote gdrive funcionando**

```bash
rclone ls gdrive:
```

Expected: lista de arquivos da raiz do Google Drive (pode ser vazia ou ter arquivos existentes). Sem erros de auth.

- [ ] **Step 6: Criar pasta de destino no Drive**

```bash
rclone mkdir gdrive:la-organizer-backups
```

Verificar:
```bash
rclone ls gdrive:la-organizer-backups
```

Expected: comando executa sem erro (pasta criada, conteúdo vazio — ok).

---

## Task 2: Criar e testar backup.sh na VPS

**Files:**
- Create: `/opt/LA-Organizer/backup.sh`
- Create: `/opt/LA-Organizer/backups/` (diretório)
- Create: `/opt/LA-Organizer/logs/` (diretório — pode já existir)

- [ ] **Step 1: Verificar que DATABASE_URL existe no .env**

```bash
grep DATABASE_URL /opt/LA-Organizer/.env
```

Expected: linha como `DATABASE_URL=postgresql://...`. Se não existir ou tiver nome diferente (ex: `DB_URL`, `SUPABASE_DB_URL`), anote o nome exato — use ele no script do Step 2.

- [ ] **Step 2: Criar o script backup.sh**

```bash
cat > /opt/LA-Organizer/backup.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

LOG=/opt/LA-Organizer/logs/backup.log
BACKUP_DIR=/opt/LA-Organizer/backups
REMOTE="gdrive:la-organizer-backups"
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
FILENAME="backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
mkdir -p "$(dirname "$LOG")"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

log "INÍCIO backup"

# Carregar DATABASE_URL do .env e exportar para processos filhos
set -a; source /opt/LA-Organizer/.env; set +a

# pg_dump
pg_dump "$DATABASE_URL" | gzip > "$BACKUP_DIR/$FILENAME"
SIZE=$(du -sh "$BACKUP_DIR/$FILENAME" | cut -f1)
log "pg_dump OK — $SIZE — $FILENAME"

# Rotação local: manter apenas últimos 14 dias
find "$BACKUP_DIR" -name "backup_*.sql.gz" -mtime +14 -delete
COUNT=$(find "$BACKUP_DIR" -name "backup_*.sql.gz" | wc -l)
log "rotação local OK — $COUNT arquivo(s) mantidos"

# Drive: copy (acumula) + delete backups >60d
rclone copy "$BACKUP_DIR/$FILENAME" "$REMOTE/"
rclone delete --min-age 60d "$REMOTE/"
log "rclone Drive OK — arquivo copiado, backups >60d removidos"

log "CONCLUÍDO"
EOF
```

**Se o nome da variável não for `DATABASE_URL`** (descoberto no Step 1): edite a linha `pg_dump "$DATABASE_URL"` para usar o nome correto antes de salvar.

- [ ] **Step 3: Dar permissão de execução**

```bash
chmod +x /opt/LA-Organizer/backup.sh
```

- [ ] **Step 4: Verificar que pg_dump está disponível na VPS**

```bash
which pg_dump
pg_dump --version
```

Expected: caminho como `/usr/bin/pg_dump` e versão PostgreSQL. Se não encontrado:

```bash
# Ubuntu/Debian
sudo apt install -y postgresql-client

# Verificar novamente
pg_dump --version
```

- [ ] **Step 5: Executar o script manualmente (primeiro teste)**

```bash
/opt/LA-Organizer/backup.sh
```

Observe o output em tempo real. Expected:
```
[2026-04-30 XX:XX:XX] INÍCIO backup
[2026-04-30 XX:XX:XX] pg_dump OK — X.XM — backup_20260430_XXXXXX.sql.gz
[2026-04-30 XX:XX:XX] rotação local OK — 1 arquivo(s) mantidos
[2026-04-30 XX:XX:XX] rclone Drive OK — arquivo copiado, backups >60d removidos
[2026-04-30 XX:XX:XX] CONCLUÍDO
```

Se falhar em qualquer etapa: o script para com erro (por `set -euo pipefail`) e exibe a linha que falhou.

- [ ] **Step 6: Verificar arquivo gerado localmente**

```bash
ls -lh /opt/LA-Organizer/backups/
```

Expected: arquivo `backup_YYYYMMDD_HHMMSS.sql.gz` presente, tamanho > 0 (provavelmente 1-20MB dependendo do banco).

- [ ] **Step 7: Verificar arquivo no Google Drive**

```bash
rclone ls gdrive:la-organizer-backups
```

Expected: mesmo arquivo listado com tamanho em bytes.

- [ ] **Step 8: Verificar log**

```bash
cat /opt/LA-Organizer/logs/backup.log
```

Expected: as 5 linhas de log com timestamps, sem erros.

- [ ] **Step 9: Testar integridade do dump (spot check)**

```bash
# Verificar que o arquivo é um gzip válido e tem conteúdo SQL
gunzip -c /opt/LA-Organizer/backups/backup_*.sql.gz | head -5
```

Expected: primeiras linhas do dump como:
```sql
--
-- PostgreSQL database dump
--
-- Dumped from database version 15.x
```

---

## Task 3: Configurar crontab + verificar agendamento

**Files:**
- Modify: `crontab` do usuário na VPS (via `crontab -e`)

- [ ] **Step 1: Abrir crontab do usuário atual**

```bash
crontab -e
```

Se for a primeira vez, pergunta o editor. Escolha `1` (nano) ou o de sua preferência.

- [ ] **Step 2: Adicionar linha de agendamento**

Adicione esta linha ao final do arquivo:

```cron
0 6 * * * /opt/LA-Organizer/backup.sh >> /opt/LA-Organizer/logs/backup.log 2>&1
```

Explicação: `0 6 * * *` = todo dia às 06:00 UTC (03:00 BRT). O `>> ... 2>&1` garante que tanto stdout quanto stderr sejam appendados ao log (o script já usa `tee` internamente, mas esta linha é um safety net para erros antes da função `log()` inicializar).

Salve e feche o editor.

- [ ] **Step 3: Verificar que o crontab foi salvo**

```bash
crontab -l
```

Expected: a linha `0 6 * * * /opt/LA-Organizer/backup.sh ...` aparece.

- [ ] **Step 4: Verificar que o cron daemon está rodando**

```bash
systemctl status cron
# ou em alguns sistemas:
systemctl status crond
```

Expected: `Active: active (running)`. Se inativo:
```bash
sudo systemctl enable cron && sudo systemctl start cron
```

- [ ] **Step 5: Smoke test com horário imediato (opcional mas recomendado)**

Para confirmar que o cron consegue executar o script (permissões, PATH do cron podem diferir do shell):

```bash
# Agendar para rodar em 1 minuto (ex: se agora são 15:23, coloque 15:24)
crontab -e
# Adicionar temporariamente: 24 15 * * * /opt/LA-Organizer/backup.sh >> /opt/LA-Organizer/logs/backup.log 2>&1
```

Aguarde o minuto passar. Depois:

```bash
tail -20 /opt/LA-Organizer/logs/backup.log
```

Expected: nova entrada com timestamp do minuto agendado, terminando em "CONCLUÍDO".

Remova a linha temporária do crontab após verificar:
```bash
crontab -e   # deletar a linha temporária
```

- [ ] **Step 6: Documentar procedimento de restore**

Criar arquivo de referência na VPS:

```bash
cat > /opt/LA-Organizer/RESTORE.md << 'EOF'
# Restore do banco de dados

## Listar backups disponíveis

### VPS local
ls -lh /opt/LA-Organizer/backups/

### Google Drive
rclone ls gdrive:la-organizer-backups

## Restaurar backup local

```bash
set -a; source /opt/LA-Organizer/.env; set +a
gunzip -c /opt/LA-Organizer/backups/backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

## Restaurar backup do Drive (se VPS perdido)

```bash
# No novo servidor, após configurar rclone:
rclone copy gdrive:la-organizer-backups/backup_YYYYMMDD_HHMMSS.sql.gz .
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

## Verificar integridade do dump sem restaurar

```bash
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | head -5
```
EOF
```

- [ ] **Step 7: Verificação final — sair da VPS e confirmar remotamente**

```bash
exit   # sair da sessão SSH

# Do seu terminal local:
ssh -i ~/.ssh/tom_vps tom "crontab -l && echo '---' && tail -5 /opt/LA-Organizer/logs/backup.log && echo '---' && ls -lh /opt/LA-Organizer/backups/"
```

Expected: crontab mostra a linha de agendamento, log mostra "CONCLUÍDO" na última entrada, backups/ lista o arquivo gerado.

---

## Self-Review

**Spec coverage:**
- ✅ Script backup.sh (Task 2)
- ✅ rclone setup + gdrive remote (Task 1)
- ✅ Rotação local 14d (Task 2 Step 2 — `find -mtime +14 -delete`)
- ✅ Sync Drive 60d (Task 2 Step 2 — `rclone copy + delete --min-age 60d`)
- ✅ Crontab 06h UTC (Task 3)
- ✅ `set -a; source .env; set +a` para exportar DATABASE_URL (Task 2 Step 2)
- ✅ Log em arquivo (Task 2 Step 8)
- ✅ Restore documentado (Task 3 Step 6)

**No placeholders.**

**Note:** Este plano não usa git commit (projeto não tem git local — artefatos ficam na VPS diretamente).
