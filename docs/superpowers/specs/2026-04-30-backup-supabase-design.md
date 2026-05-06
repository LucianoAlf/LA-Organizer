# Spec: Backup Automático Supabase
**Data:** 2026-04-30
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Supabase free tier não tem PITR (Point-in-Time Recovery) nativo. Se o banco quebrar, não há recuperação automática. Este spec define um backup diário automatizado via `pg_dump` + rclone para Google Drive, rodando no VPS existente.

---

## Decisões de design

| # | Decisão | Escolha |
|---|---|---|
| P1 | Abordagem | Shell script + crontab (não pm2, não GitHub Actions) |
| P2 | Destino | VPS local (rolling 14 dias) + Google Drive (rolling 60 dias) |
| P3 | Frequência | Diário às 03h BRT (06h UTC) |
| P4 | Retenção VPS | 14 dias (delete arquivos > 14d) |
| P5 | Retenção Drive | 60 dias (`rclone copy` + `rclone delete --min-age 60d`) |
| P6 | Credenciais | Carrega `DATABASE_URL` do `.env` existente via `source` |
| P7 | Alertas | Log em arquivo — sem notificação automática (YAGNI) |

---

## Seção 1: Script de backup

**Arquivo:** `/opt/LA-Organizer/backup.sh`

```bash
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

# Sync para Google Drive: copy (acumula) + delete > 60d
rclone copy "$BACKUP_DIR/$FILENAME" "$REMOTE/"
rclone delete --min-age 60d "$REMOTE/"
log "rclone Drive OK — arquivo copiado, backups >60d removidos"

log "CONCLUÍDO"
```

**Permissões:**
```bash
chmod +x /opt/LA-Organizer/backup.sh
```

---

## Seção 2: rclone setup (uma vez)

```bash
# Instalar rclone (se não instalado)
apt install rclone   # ou: curl https://rclone.org/install.sh | bash

# Configurar remote "gdrive"
rclone config
# → n (new remote) → nome: gdrive → tipo: drive → client_id: vazio → client_secret: vazio
# → scope: 1 (full access) → root_folder_id: vazio → service_account: vazio
# → y (usar auto config) → abre URL no browser → autoriza com conta Google → cola código
# → y (shared drive: não) → confirma

# Testar
rclone ls gdrive:
```

Credenciais armazenadas em `~/.config/rclone/rclone.conf` na VPS.

**Estrutura no Google Drive:**
```
la-organizer-backups/
  backup_20260430_060000.sql.gz
  backup_20260501_060000.sql.gz
  ...  (máximo 60 arquivos diários)
```

---

## Seção 3: Crontab

```bash
crontab -e
```

Adicionar linha:
```cron
0 6 * * * /opt/LA-Organizer/backup.sh >> /opt/LA-Organizer/logs/backup.log 2>&1
```

03h BRT = 06h UTC. Logs acumulam em `/opt/LA-Organizer/logs/backup.log`.

**Verificação manual:**
```bash
ssh -i ~/.ssh/tom_vps tom "tail -30 /opt/LA-Organizer/logs/backup.log"
```

---

## Seção 4: Restore

```bash
# Baixar backup do Drive (se VPS não disponível)
rclone copy gdrive:la-organizer-backups/backup_YYYYMMDD_HHMMSS.sql.gz .

# Restaurar
gunzip -c backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

---

## Fora de escopo

- Notificação automática de falha por WhatsApp/email (Fatia 2 se uso real mostrar necessidade)
- Backup criptografado (PII low-risk neste contexto; pode ser adicionado com `gpg -c`)
- Múltiplos destinos (S3, Backblaze)
- Backup incremental (dump completo é suficiente para o tamanho atual)
