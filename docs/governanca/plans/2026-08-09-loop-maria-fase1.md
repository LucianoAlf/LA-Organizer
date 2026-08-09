# LOOP-MARIA Fase 1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o raio de ação do laudo diário da Maria, transferir a rotina para o gateway dela com entrega no WhatsApp próprio, e criar as fundações de dados (acervo, KIs, runs, sondas) sobre as quais o ciclo de governança vai rodar.

**Architecture:** Três blocos sequenciais. (A) Uma correção de segurança imediata no cron existente, sem mover nada de lugar. (B) A rotina migra do gateway do Alfredo para o da Maria e passa a entregar pelo WhatsApp dela. (C) Nascem quatro tabelas `maria_gov_*` no Super Folha com identidade técnica própria e idempotência determinística, mais a função pura do placar. Cada bloco é reversível e verificado por observação, não por presunção.

**Tech Stack:** OpenClaw CLI (`openclaw cron`), Node 20 (`node:test`), PostgreSQL/Supabase (`ubdvtjbitozhkuvvqkxj`), UAZAPI, systemd.

**Spec de origem:** `docs/governanca/specs/2026-08-09-loop-maria-design.md`

## Global Constraints

- **Zona congelada — NUNCA editar:** `/home/maria/.openclaw/workspace/bridges/maria-uazapi/bridge.js` e qualquer arquivo em `/home/maria/.openclaw/workspace/skills/`. Decisão do dono em 09/08/2026. Se uma task parecer exigir isso, ela está errada: pare e reporte.
- **Acesso:** `ssh maria "comando"` (alias configurado; usuário `claude`, sudo NOPASSWD). Ler arquivos de `/home/maria` exige `sudo`. Rodar como a Maria exige `sudo -u maria`. O gateway do Alfredo exige `sudo env HOME=/root`.
- **Timezone:** a VPS roda UTC. Toda data para humano é BRT — use `TZ=America/Sao_Paulo date +%F` e `at time zone 'America/Sao_Paulo'` no SQL. Nunca `toISOString().slice(0,10)`.
- **Nunca deletar dado de produção** sem OK explícito do Alf. Nesta fase nenhuma task deleta nada.
- **Reversibilidade:** toda task que muda estado grava um snapshot do estado anterior antes de mudar, no diretório `/home/maria/.openclaw/workspace/backups/loop-maria-fase1/`.
- **Prova antes de afirmação:** nenhuma task é dada como concluída sem o comando de verificação ter sido executado e a saída conferida.
- **Modelo:** primary da Maria hoje é `opencode-go/deepseek-v4-flash`. Não trocar.
- **IDs fixos:** cron do laudo (gateway do Alfredo) = `a47a1c2b-51f9-4097-a85a-f8db87087809`. Projeto Supabase = `ubdvtjbitozhkuvvqkxj`. WhatsApp da Maria = `5521989784688`. WhatsApp do Alf = `5521981278047`.
- **Sintaxe do CLI (corrigida na execução de 09/08):** `openclaw cron get <id>` **já devolve JSON e rejeita `--json`** com "OpenClaw does not recognize option". Só `cron list` aceita a flag. A versão anterior deste plano trazia `--json` no `get` e o Step 1 falhou por isso — o gate do snapshot pegou antes de qualquer mudança, que é o comportamento desejado.

---

## File Structure

| caminho | responsabilidade | bloco |
|---|---|---|
| `/home/maria/.openclaw/workspace/backups/loop-maria-fase1/` | snapshots de reversão de cada task | todos |
| `/home/maria/.openclaw/workspace/tools/superfolha_sql.py` | consulta read-only ao Super Folha (cópia da do Alfredo) | B |
| `/home/maria/.openclaw/workspace/gov/placar-governanca.mjs` | função **pura** do placar (ETAPA 1) — sem I/O, sem relógio | C |
| `/home/maria/.openclaw/workspace/gov/placar-governanca.test.mjs` | testes do placar | C |
| `migrations/20260809_maria_gov_fundacoes.sql` (aplicada via MCP) | as 4 tabelas + ator técnico + índices de idempotência | C |

**Por que `gov/` separado:** o código de governança não pode morar em `tools/` (que a Maria usa em runtime) nem perto de `bridges/`/`skills/` (congelados). Diretório próprio deixa o raio de ação óbvio para quem ler depois.

---

## BLOCO A — Fechar o `toolsAllow` (hoje, antes de tudo)

### Task 1: Restringir as ferramentas do cron do laudo

O cron roda com `toolsAllowIsDefault: true`, incluindo `cron`, `subagents`, `sessions_spawn`, `apply_patch`, `edit` e `supabase-lareport__apply_migration` — migration no banco do LA Report a partir de um agente financeiro. Reduzir para o mínimo que a rotina comprovadamente usa.

⚠️ **`write` FICA nesta task.** Na rodada de 09/08 o agente escreveu ~20 arquivos `.sql` para contornar `exec preflight: complex interpreter`. Removê-lo aqui quebra o laudo. Ele cai na Task 5, junto com a instalação do `superfolha_sql.py`.

⚠️⚠️ **Esta task fecha a porta e deixa a janela — e isso é declarado, não escondido.** Remover
`apply_migration`, `cron`, `edit` e `subagents` reduz **alcance acidental**, não alcance real:
com `exec` o agente roda `curl` ou `psql` e chega em qualquer banco cuja credencial esteja no
ambiente. Verificado em 09/08: o env da Maria contém **`MARIA_LAREPORT_RPC_DATABASE_URL`**
(connection string direta ao Postgres do LA Report) e `FOLHAPAGAMENTO_SUPABASE_SERVICE_ROLE`.
Enquanto o cron roda no gateway do Alfredo, o env é o do root e não podemos mexer nele sem
afetar os outros jobs dele. **O fechamento real acontece na Task 3**, quando a rotina passa a
rodar sob env controlado. Esta task vale porque é barata e imediata — não porque resolve.

**Files:**
- Modify: cron `a47a1c2b-51f9-4097-a85a-f8db87087809` no gateway do Alfredo (`HOME=/root`)
- Create: `/home/maria/.openclaw/workspace/backups/loop-maria-fase1/cron-a47a1c2b-antes.json`

**Interfaces:**
- Consumes: nada
- Produces: o mesmo cron, com `toolsAllow = ["exec","read","write"]`

- [ ] **Step 1: Snapshot do job atual**

```bash
ssh maria 'sudo mkdir -p /home/maria/.openclaw/workspace/backups/loop-maria-fase1 && \
sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 \
  > /tmp/cron-antes.json && \
sudo cp /tmp/cron-antes.json /home/maria/.openclaw/workspace/backups/loop-maria-fase1/cron-a47a1c2b-antes.json && \
sudo wc -c /home/maria/.openclaw/workspace/backups/loop-maria-fase1/cron-a47a1c2b-antes.json'
```

Esperado: um arquivo com mais de 1000 bytes. Se vier vazio, **pare** — sem snapshot não se mexe.

- [ ] **Step 2: Registrar o baseline do laudo de hoje**

Guarde o laudo de 09/08 para comparação (é o critério de sucesso do Step 5):

```bash
ssh maria 'sudo python3 -c "
import json
f=\"/root/.openclaw/agents/main/sessions/559952d5-d133-4d56-a3e5-1838b1366c23.jsonl\"
def walk(o):
    if isinstance(o,str): yield o
    elif isinstance(o,dict):
        for v in o.values(): yield from walk(v)
    elif isinstance(o,list):
        for v in o: yield from walk(v)
d=json.loads(open(f,encoding=\"utf-8\",errors=\"replace\").readlines()[137])
print(max(walk(d),key=len))
" | sudo tee /home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-baseline-0908.txt | head -5'
```

Esperado: começa com `MARIA — LAUDO DIÁRIO V1A` e contém `Status geral:`.

- [ ] **Step 3: Aplicar a restrição**

```bash
ssh maria 'sudo env HOME=/root openclaw cron edit a47a1c2b-51f9-4097-a85a-f8db87087809 --tools "exec,read,write"'
```

- [ ] **Step 4: Verificar que a lista ficou exatamente a esperada**

```bash
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 \
  | python3 -c "import sys,json; d=json.load(sys.stdin); p=d.get(\"payload\",{}); print(\"tools:\",p.get(\"toolsAllow\")); print(\"isDefault:\",p.get(\"toolsAllowIsDefault\"))"'
```

Esperado, literalmente:
```
tools: ['exec', 'read', 'write']
isDefault: False
```

Se `isDefault` continuar `True`, a flag não pegou — **reverta pelo Step 7 e reporte**. Nenhum `apply_migration`, `cron`, `subagents` ou `edit` pode aparecer na lista.

- [ ] **Step 5: Validação por execução forçada (não esperar as 07:00)**

```bash
ssh maria 'sudo env HOME=/root TZ=America/Sao_Paulo openclaw cron run a47a1c2b-51f9-4097-a85a-f8db87087809 2>&1 | tail -20'
```

Esperado: a execução completa sem erro de permissão de ferramenta. Depois, comparar o laudo produzido com `laudo-baseline-0908.txt`: as nove seções numeradas devem estar presentes e os números devem ser da mesma ordem de grandeza (contas pendentes na casa das centenas, e-mails sem match nas dezenas). **Diferença de valor é esperada** (o dia mudou); **ausência de seção não é**.

Se aparecer `permission denied` para alguma ferramenta que a rotina precisa, adicione **apenas aquela** ao `--tools` e repita o Step 4.

- [ ] **Step 6: Confirmar que a entrega ocorreu**

O laudo forçado é entregue no Telegram do Alf (ainda não migramos). Confirme com o Alf que chegou, ou verifique o `lastDeliveryStatus`:

```bash
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 \
  | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get(\"state\",d); print(\"status:\",s.get(\"lastRunStatus\"),\"| entrega:\",s.get(\"lastDeliveryStatus\"),\"| diag:\",str(s.get(\"lastDiagnosticSummary\"))[:120])"'
```

Esperado: `status: ok` e `entrega: delivered`. **Atenção:** `lastRunStatus: ok` convivendo com diagnóstico de falha é conhecido e não invalida a rodada — o que invalida é seção faltando no laudo.

- [ ] **Step 7: Procedimento de reversão (só se algo acima falhar)**

```bash
ssh maria 'sudo env HOME=/root openclaw cron edit a47a1c2b-51f9-4097-a85a-f8db87087809 --clear-tools'
```

Isso devolve o comportamento anterior (todas as ferramentas). Reporte o motivo antes de tentar de novo.

- [ ] **Step 8: Baselinar onde a rotina escreve (pré-requisito da Task 5)**

A Task 5 vai remover `write`. Para não checar o lugar errado e produzir falso verde, registre
**agora**, com `write` ainda ligado, os caminhos reais que a rodada gerou:

```bash
ssh maria 'sudo find /root/.openclaw/workspace /home/maria/.openclaw/workspace /tmp \
  -maxdepth 3 -name "*.sql" -newermt "-1 hour" 2>/dev/null \
  | sudo tee /home/maria/.openclaw/workspace/backups/loop-maria-fase1/caminhos-sql-baseline.txt; \
  echo "---"; sudo wc -l < /home/maria/.openclaw/workspace/backups/loop-maria-fase1/caminhos-sql-baseline.txt'
```

Esperado: uma lista não-vazia. **Se vier vazia, a rotina não usou `write` nesta rodada** — anote
isso, porque muda a Task 5 (o `write` pode cair mais cedo). Se vier cheia, esses são os caminhos
que a Task 5 confere.

- [ ] **Step 9: Registrar a conclusão**

Anexe ao relatório: a lista de tools antes e depois, a confirmação dos Steps 5 e 6, e os caminhos
do Step 8.

---

## BLOCO B — A Maria vira dona da própria rotina

### Task 2: Instalar a ferramenta de consulta no workspace da Maria

Hoje `superfolha_sql.py` só existe em `/root/.openclaw/workspace/tools/` (do Alfredo). Sem ela no workspace da Maria, o cron migrado não consegue ler o Super Folha.

**Files:**
- Create: `/home/maria/.openclaw/workspace/tools/superfolha_sql.py`

**Interfaces:**
- Consumes: nada
- Produces: `python3 /home/maria/.openclaw/workspace/tools/superfolha_sql.py --sql "<SQL>"` devolvendo `STATUS 201` seguido de JSON

- [ ] **Step 1: Copiar preservando permissão de execução**

```bash
ssh maria 'sudo cp /root/.openclaw/workspace/tools/superfolha_sql.py /home/maria/.openclaw/workspace/tools/superfolha_sql.py && \
sudo chown maria:maria /home/maria/.openclaw/workspace/tools/superfolha_sql.py && \
sudo chmod 750 /home/maria/.openclaw/workspace/tools/superfolha_sql.py && \
sudo ls -la /home/maria/.openclaw/workspace/tools/superfolha_sql.py'
```

- [ ] **Step 2: Descobrir de qual credencial ela depende**

```bash
ssh maria 'sudo grep -oE "os\.environ[^)]{0,40}|getenv\([^)]{0,40}" /home/maria/.openclaw/workspace/tools/superfolha_sql.py | head -10'
```

Anote os nomes das variáveis.

⚠️ **NÃO copie `service_role` do env do root.** A spec decidiu que o processo de governança roda
com credencial própria e reduzida — `service_role` dá bypass de RLS e mataria o isolamento do
held-out antes mesmo de ele existir. O laudo é **somente leitura**: crie um papel de banco
read-only agora, que custa dez minutos e evita desfazer depois.

Aplicar no Supabase `ubdvtjbitozhkuvvqkxj`:

```sql
-- Papel exclusivo do laudo/governanca: le tudo do schema public, nao escreve nada
create role maria_gov_ro nologin;
grant usage on schema public to maria_gov_ro;
grant select on all tables in schema public to maria_gov_ro;
alter default privileges in schema public grant select on tables to maria_gov_ro;
```

Verificar que não escreve:

```sql
select has_table_privilege('maria_gov_ro','contas_pagar','INSERT') as pode_inserir,
       has_table_privilege('maria_gov_ro','contas_pagar','SELECT') as pode_ler;
```

Esperado: `pode_inserir = false`, `pode_ler = true`. Se `pode_inserir` vier `true`, **pare** — o
papel herdou privilégio de algum outro e não serve.

A variável de conexão do laudo aponta para esse papel, e entra no env com nome próprio
(`MARIA_GOV_DATABASE_URL`), nunca reusando `FOLHAPAGAMENTO_SUPABASE_SERVICE_ROLE`.

⚠️ **Ao anexar no `.env`, confira antes.** `>>` cego duplica chave, e chave duplicada em arquivo
de env tem precedência indefinida entre implementações:

```bash
ssh maria 'sudo grep -c "^MARIA_GOV_DATABASE_URL=" /home/maria/.openclaw/private/maria.env || echo 0'
```

Esperado: `0` antes de anexar; `1` depois. Se já existir, **edite a linha existente**, não anexe.

- [ ] **Step 3: Teste de fumaça — rodar como a Maria**

```bash
ssh maria 'sudo -u maria bash -lc "set -a; . /home/maria/.openclaw/private/maria.env; set +a; \
python3 /home/maria/.openclaw/workspace/tools/superfolha_sql.py --sql \"select count(*) as total from contas_pagar where status = @@pendente@@\"" 2>&1 | head -8' 
```

(Substitua `@@pendente@@` por `'"'"'pendente'"'"'` — aspas simples escapadas para o shell.)

Esperado: `STATUS 201` seguido de um JSON com `total` na casa das centenas. Se vier erro de credencial, volte ao Step 2.

- [ ] **Step 4: Commit do estado (backup)**

```bash
ssh maria 'sudo -u maria bash /home/maria/.openclaw/workspace/scripts/backup-to-github-safe.sh --push 2>&1 | tail -5'
```

Esperado: termina sem `ERRO:`. O backup foi restaurado em 09/08 (commit `c8cacaf`), então isso deve passar.

---

### Task 3: Criar o cron do laudo no gateway da Maria

**Files:**
- Create: novo cron no gateway da Maria (porta 19789)
- Create: `/home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt`

**Interfaces:**
- Consumes: `superfolha_sql.py` no workspace da Maria (Task 2)
- Produces: cron `maria-laudo-diario-v1a-own` com entrega no WhatsApp da Maria

- [ ] **Step 1: Extrair o payload atual (não reescrever o prompt)**

O prompt das nove auditorias é conteúdo validado — copiar literalmente, não recriar:

```bash
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[\"payload\"][\"message\"])" \
  | sudo tee /home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt | wc -c'
```

Esperado: cerca de 1801 caracteres.

### ⚠️ Correção de desenho (revisão de 09/08) — a entrega NÃO fica com o LLM

A versão anterior desta task punha no `--message` a instrução *"ao terminar, envie executando
python3 enviar-whatsapp.py"*. **Isso é o princípio 2 do modelo virado do avesso:** a entrega volta
a ser decisão e afirmação do LLM, e a falha volta a ser silenciosa — ele diz que enviou e não
enviou, que foi exatamente o restart fantasma do TOM em 09/08 08:21.

**Desenho correto:** o cron dispara um **payload de comando**, não um turno de agente. O comando é
um wrapper que (1) chama o agente e captura a saída, (2) valida que não veio vazia, (3) sanitiza
markdown para WhatsApp, (4) envia por código e (5) reporta o status real. O LLM produz o texto;
**o código entrega e afirma.**

Isso resolve três problemas de uma vez: a entrega sai do prompt, o env fica sob controle via
`--command-env`, e a sanitização deixa de depender de o modelo lembrar de não usar markdown.

- [ ] **Step 2: Criar o wrapper de execução e entrega**

```bash
# /home/maria/.openclaw/workspace/gov/laudo-diario.sh
```

```bash
#!/usr/bin/env bash
# Wrapper do laudo diario. O agente PRODUZ; este script ENTREGA e AFIRMA.
set -uo pipefail

GOV=/home/maria/.openclaw/workspace/gov
PAYLOAD=/home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt
SAIDA=$(mktemp /tmp/laudo-XXXXXX.txt)
DESTINO=5521981278047
LOG=/home/maria/.openclaw/workspace/logs/laudo-diario.log

registrar() { echo "[$(TZ=America/Sao_Paulo date '+%F %T %Z')] $*" >> "$LOG"; }

registrar "inicio"

# 1. Roda o agente, captura a saida
if ! openclaw agent --agent maria --session isolated \
     --tools "exec,read" \
     --message "$(cat "$PAYLOAD")" > "$SAIDA" 2>>"$LOG"; then
  registrar "ERRO: agente falhou"
  python3 "$GOV/enviar-whatsapp.py" --to "$DESTINO" \
    --texto "MARIA — LAUDO DIARIO: falhei ao gerar o laudo de hoje. Causa tecnica no log do servidor. Nenhum dado foi alterado." \
    >> "$LOG" 2>&1
  exit 1
fi

# 2. Saida vazia e falha, nunca silencio
if [ ! -s "$SAIDA" ] || [ "$(wc -c < "$SAIDA")" -lt 200 ]; then
  registrar "ERRO: saida vazia ou curta demais ($(wc -c < "$SAIDA") bytes)"
  python3 "$GOV/enviar-whatsapp.py" --to "$DESTINO" \
    --texto "MARIA — LAUDO DIARIO: rodei mas voltei sem texto. Isso e bug meu, nao resultado. Nada foi alterado." \
    >> "$LOG" 2>&1
  exit 1
fi

# 3+4. Sanitiza e envia por CODIGO
if python3 "$GOV/enviar-whatsapp.py" --to "$DESTINO" --arquivo "$SAIDA" >> "$LOG" 2>&1; then
  registrar "OK: laudo entregue ($(wc -c < "$SAIDA") bytes)"
  rm -f "$SAIDA"
  exit 0
else
  registrar "ERRO: laudo gerado mas NAO entregue"
  exit 1
fi
```

```bash
ssh maria 'sudo -u maria mkdir -p /home/maria/.openclaw/workspace/gov && \
sudo -u maria tee /home/maria/.openclaw/workspace/gov/laudo-diario.sh > /dev/null <<"EOF"
<cole o conteudo acima>
EOF
sudo -u maria chmod 750 /home/maria/.openclaw/workspace/gov/laudo-diario.sh && echo CRIADO'
```

- [ ] **Step 3: Criar o utilitário de envio com sanitização markdown→WhatsApp**

O laudo usa `**negrito**` e `##`, que o WhatsApp **não renderiza** — chegam como asteriscos
literais. O TOM tem `wa-format.js` exatamente para isso; aqui vai a versão mínima.

```python
# /home/maria/.openclaw/workspace/gov/enviar-whatsapp.py
import argparse, json, re, sys, urllib.request

LIMITE = 1200  # ~15 linhas no celular

def carregar_env(caminho="/home/maria/.openclaw/private/maria.env"):
    env = {}
    for linha in open(caminho):
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, v = linha.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
    return env

def para_whatsapp(texto):
    """WhatsApp so tem *negrito*, _italico_, ~riscado~ e crase. Markdown chega literal."""
    saida = []
    for linha in texto.split("\n"):
        if re.fullmatch(r"\s*[-*_]{3,}\s*", linha):      # linha horizontal some
            continue
        linha = re.sub(r"^\s*#{1,6}\s*(.+)$", r"*\1*", linha)   # titulo -> negrito
        linha = re.sub(r"^(\s*)[-*+]\s+", r"\1• ", linha)       # bullet -> ponto
        linha = re.sub(r"^\s*>\s?", "", linha)                   # citacao perde marcador
        saida.append(linha)
    t = "\n".join(saida)
    t = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1: \2", t)        # link
    t = re.sub(r"\*{2,}", "*", t)                                # ** -> *
    t = re.sub(r"_{2,}", "_", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()

def dividir(texto, limite=LIMITE):
    """Divide em fronteira de paragrafo. NUNCA trunca: num laudo a conclusao fica no fim."""
    if len(texto) <= limite:
        return [texto]
    partes, atual = [], ""
    for par in re.split(r"\n{2,}", texto):
        if len(atual) + len(par) + 2 > limite and atual:
            partes.append(atual.strip())
            atual = par
        else:
            atual = f"{atual}\n\n{par}" if atual else par
    if atual.strip():
        partes.append(atual.strip())
    return partes

def enviar(numero, texto):
    env = carregar_env()
    url = env["MARIA_UAZAPI_URL"].rstrip("/") + "/send/text"
    corpo = json.dumps({"number": numero, "text": texto}).encode()
    req = urllib.request.Request(
        url, data=corpo,
        headers={"token": env["MARIA_UAZAPI_TOKEN"], "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, json.loads(r.read().decode()).get("messageid", "")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--arquivo")
    g.add_argument("--texto")
    a = p.parse_args()

    bruto = open(a.arquivo, encoding="utf-8").read() if a.arquivo else a.texto
    if not bruto.strip():
        print("ERRO: nada a enviar", file=sys.stderr)
        sys.exit(1)

    partes = dividir(para_whatsapp(bruto))
    enviadas = 0
    for i, parte in enumerate(partes, 1):
        status, mid = enviar(a.to, parte)
        print(f"parte {i}/{len(partes)} HTTP {status} messageid={mid}")
        if status != 200:
            print(f"ERRO: parte {i} de {len(partes)} falhou", file=sys.stderr)
            sys.exit(1)   # entrega parcial e FALHA, nao sucesso
        enviadas += 1
    sys.exit(0 if enviadas == len(partes) else 1)
```

- [ ] **Step 4: Criar o cron como payload de comando, com env controlado**

```bash
ssh maria 'sudo -u maria openclaw cron add "maria-laudo-diario-v1a-own" \
  --cron "0 7 * * *" --tz America/Sao_Paulo \
  --command "bash /home/maria/.openclaw/workspace/gov/laudo-diario.sh" \
  --command-cwd /home/maria/.openclaw/workspace \
  --command-env "MARIA_LAREPORT_RPC_DATABASE_URL=" \
  --command-env "FOLHAPAGAMENTO_SUPABASE_SERVICE_ROLE=" \
  --description "Laudo diario V1A — wrapper entrega pelo WhatsApp da propria Maria" \
  --disabled'
```

⚠️ **Os dois `--command-env` vazios REDUZEM, não fecham — e dizer que fecham seria pior que o
buraco.** Eles limpam a variável do ambiente do processo, mas o arquivo
`/home/maria/.openclaw/private/maria.env` continua no disco e legível pelo usuário `maria`, que é
quem roda o job. Com `exec`, um `. /home/maria/.openclaw/private/maria.env` devolve tudo — e este
plano **ensina esse comando** no teste de fumaça da Task 2, além de o `enviar-whatsapp.py` ler o
arquivo direto do disco. A trava seria desfeita pela ferramenta do próprio plano.

Com `exec` ligado e o arquivo legível pelo mesmo usuário, **não existe contenção por manipulação
de env.** Conter de verdade exige uma de duas coisas: a credencial não existir em lugar legível
por esse processo, ou o job rodar sob outro usuário do SO.

Mantenha os `--command-env` mesmo assim: custam nada e reduzem alcance acidental. Só não confunda
redutor com fechadura — o buraco declarado na Task 1 **continua aberto** e se fecha na dívida
abaixo.

**Dívida com dono e prazo — DESCOBERTA em 09/08:** varredura no workspace da Maria
(`bridges/`, `tools/`, `private-mcp/`, e o workspace inteiro fora de backups) encontrou **zero
consumidores** de `MARIA_LAREPORT_RPC_DATABASE_URL`. A única ocorrência é o documento
`docs/lareport/maria-lareport-rpc-contract-20260625.md`. Ou seja: **é uma connection string de
produção parada num env de VPS compartilhada, alcançável por um agente com `exec`, sem ninguém
usando.** Ação: remover a variável do `maria.env` (com backup) e **rotacionar a senha no LA
Report** — a rotação se justifica pela exposição, independentemente de alguém ter usado. Precisa
de OK do Alf porque a rotação afeta outro sistema.

`--disabled`: nasce desligado, liga só depois de validado.

- [ ] **Step 5: Rodar forçado com o job ainda desabilitado**

```bash
ssh maria 'sudo -u maria openclaw cron list --json | python3 -c "import sys,json; [print(j[\"id\"], j[\"name\"]) for j in json.load(sys.stdin)[\"jobs\"]]"'
```

Anote o id novo, então:

```bash
ssh maria 'sudo -u maria TZ=America/Sao_Paulo openclaw cron run <ID_NOVO> 2>&1 | tail -20'
```

- [ ] **Step 5: Verificar a entrega pelo lado de fora (não pela afirmação do agente)**

```bash
ssh maria 'sudo python3 - <<"PY"
import json, urllib.request
env={}
for l in open("/home/maria/.openclaw/private/maria.env"):
    l=l.strip()
    if l and not l.startswith("#") and "=" in l:
        k,v=l.split("=",1); env[k]=v.strip().strip(chr(34)).strip(chr(39))
url=env["MARIA_UAZAPI_URL"].rstrip("/")+"/chat/find"
req=urllib.request.Request(url,data=json.dumps({"number":"5521981278047","limit":1}).encode(),
    headers={"token":env["MARIA_UAZAPI_TOKEN"],"content-type":"application/json"})
print(urllib.request.urlopen(req,timeout=25).read().decode()[:400])
PY'
```

Esperado: a última mensagem para o Alf é o laudo, com `fromMe: true`. Se a API de listagem divergir, use `/message/find` com o `messageid` que o Step 4 imprimiu.

**Critério de aceite — chegada E formato, não só chegada.** O laudo foi validado no Telegram, que
renderiza markdown; o WhatsApp não. E formato foi exatamente o que causou a crise de 05–08/08.
Os três critérios juntos:

1. Chegou **do número da Maria** (`5521989784688`), não do Telegram.
2. As **nove seções numeradas** estão presentes e legíveis.
3. **Nenhum artefato de markdown cru** — sem `**`, sem `##`, sem `|` de tabela. Se aparecer, o
   `para_whatsapp()` do Step 3 não pegou aquele caso; corrija ali, não no prompt.

Enquanto o golden-file da Fatia 4 não existir, **esta primeira entrega precisa de olho humano**
(Alf ou Hugo). É a única verificação de formato que temos hoje.

- [ ] **Step 6: Habilitar o cron novo**

```bash
ssh maria 'sudo -u maria openclaw cron enable <ID_NOVO> && sudo -u maria openclaw cron list --json | python3 -c "import sys,json; [print(j[\"name\"], j[\"enabled\"], j.get(\"schedule\")) for j in json.load(sys.stdin)[\"jobs\"]]"'
```

---

### Task 4: Desligar o cron antigo (sem apagar)

**Files:**
- Modify: cron `a47a1c2b-...` no gateway do Alfredo

- [ ] **Step 1: Desabilitar, não remover**

```bash
ssh maria 'sudo env HOME=/root openclaw cron disable a47a1c2b-51f9-4097-a85a-f8db87087809'
```

`rm` apagaria o histórico e o payload validado. `disable` é reversível com `enable`.

- [ ] **Step 2: Confirmar que só um dos dois está ativo**

```bash
ssh maria 'echo "--- ALFREDO ---"; sudo env HOME=/root openclaw cron list --all --json | python3 -c "import sys,json; [print(j[\"name\"], \"enabled=\", j[\"enabled\"]) for j in json.load(sys.stdin)[\"jobs\"] if \"laudo\" in j[\"name\"]]"; echo "--- MARIA ---"; sudo -u maria openclaw cron list --all --json | python3 -c "import sys,json; [print(j[\"name\"], \"enabled=\", j[\"enabled\"]) for j in json.load(sys.stdin)[\"jobs\"]]"'
```

Esperado: o do Alfredo com `enabled= False`, o da Maria com `enabled= True`. **Dois laudos ativos gerariam mensagem duplicada — se ambos aparecerem ativos, pare e corrija.**

- [ ] **Step 3: Instalar o dead-man's switch (a rede da única janela quase-irreversível)**

Depois do Step 1 o cron antigo está desabilitado. Se o novo falhar às 07:00, o desfecho é
**nenhum laudo e ninguém sabe** — o único modo de falha que o modelo proíbe. Uma verificação às
07:30 fecha isso:

```bash
# /home/maria/.openclaw/workspace/gov/laudo-vigia.sh
```

```bash
#!/usr/bin/env bash
# Roda 07:30 BRT. Afirma "saiu laudo hoje?" e, se nao, alerta e reabilita o antigo.
set -uo pipefail
LOG=/home/maria/.openclaw/workspace/logs/laudo-diario.log
GOV=/home/maria/.openclaw/workspace/gov
HOJE=$(TZ=America/Sao_Paulo date +%F)
ANTIGO=a47a1c2b-51f9-4097-a85a-f8db87087809

if grep -q "^\[$HOJE .*\] OK: laudo entregue" "$LOG" 2>/dev/null; then
  echo "laudo de $HOJE entregue — nada a fazer"
  exit 0
fi

# Nao saiu: avisa E restaura o caminho antigo, sem esperar humano
python3 "$GOV/enviar-whatsapp.py" --to 5521981278047 \
  --texto "MARIA — ALERTA: o laudo de $HOJE NAO saiu ate 07:30. Reabilitei a rotina antiga no gateway do Alfredo como contingencia. Precisa de olho humano no laudo novo."
sudo env HOME=/root openclaw cron enable "$ANTIGO"
echo "ALERTA enviado e rotina antiga reabilitada"
exit 1
```

Criar o cron do vigia:

```bash
ssh maria 'sudo -u maria openclaw cron add "maria-laudo-vigia" \
  --cron "30 7 * * *" --tz America/Sao_Paulo \
  --command "bash /home/maria/.openclaw/workspace/gov/laudo-vigia.sh" \
  --description "Dead-man switch do laudo: alerta e reabilita a rotina antiga se nao saiu"'
```

**Testar o vigia no caminho de falha, não só no de sucesso** — é o teste que importa:

```bash
ssh maria 'sudo -u maria mv /home/maria/.openclaw/workspace/logs/laudo-diario.log /tmp/log-guardado.txt; \
sudo -u maria bash /home/maria/.openclaw/workspace/gov/laudo-vigia.sh; \
echo "--- exit=$? ---"; \
sudo -u maria mv /tmp/log-guardado.txt /home/maria/.openclaw/workspace/logs/laudo-diario.log'
```

Esperado: alerta chega no WhatsApp do Alf, o cron antigo volta a `enabled=true`, e o script sai
com `1`. **Depois do teste, desabilite o antigo de novo** (Step 1) para não ficar com dois ativos.

- [ ] **Step 4: Observar a rodada real das 07:00 do dia seguinte**

Este é o checkpoint da Fatia 0. No dia seguinte, confirmar com o Alf que o laudo chegou pelo
WhatsApp da Maria no horário e no formato certo. Só então a Task 5 pode começar.

---

### Task 5: Derrubar o `write` (quitação da dívida da Task 1)

Só depois que a Task 3 estiver rodando com `superfolha_sql.py` no workspace da Maria — aí o agente não precisa mais escrever `.sql` em disco.

**Files:**
- Modify: cron novo no gateway da Maria

- [ ] **Step 1: Confirmar, nos caminhos REAIS, que a rodada não usou `write`**

⚠️ **Não invente o caminho.** Procurar `tmp_*.sql` só em `workspace/` presumiria diretório e
padrão de nome: se a rotina escrever em subdiretório ou em `/tmp`, a busca volta `0` por estar
olhando no lugar errado, você remove `write` e o laudo quebra. **Falso verde é exatamente a
classe de erro que este projeto existe para matar.** Use o baseline registrado na Task 1 Step 8:

```bash
ssh maria 'BASE=/home/maria/.openclaw/workspace/backups/loop-maria-fase1/caminhos-sql-baseline.txt; \
echo "=== caminhos que a rotina usava ==="; sudo cat $BASE; \
echo "=== esses caminhos ainda recebem arquivo novo? ==="; \
sudo cat $BASE | while read -r p; do d=$(dirname "$p"); \
  n=$(sudo find "$d" -maxdepth 1 -name "*.sql" -newermt "-1 day" 2>/dev/null | wc -l); \
  echo "$d -> $n arquivo(s) na ultima 24h"; done | sort -u'
```

Esperado: todos os diretórios com `0 arquivo(s)`. Se algum tiver arquivo novo, o agente **ainda
está contornando algo** — investigue a causa antes de remover `write`, porque removê-lo só troca
um sintoma visível por uma falha silenciosa.

Se o baseline da Task 1 tiver vindo vazio, isso significa que a rotina não usou `write` naquela
rodada — nesse caso, confirme em uma segunda rodada antes de concluir, para não decidir com
amostra de um.

- [ ] **Step 2: Restringir**

```bash
ssh maria 'sudo -u maria openclaw cron edit <ID_NOVO> --tools "exec,read"'
```

- [ ] **Step 3: Validar por execução forçada**

```bash
ssh maria 'sudo -u maria TZ=America/Sao_Paulo openclaw cron run <ID_NOVO> 2>&1 | tail -15'
```

Esperado: laudo completo, nove seções. Se falhar por falta de `write`, reverta com `--tools "exec,read,write"` e registre que a dívida continua aberta com o motivo real.

---

## BLOCO C — Fundações de dados

### Task 6: Criar as quatro tabelas e o ator técnico

Resolve, de passagem, os gates 1 e 2 da V1B: a identidade técnica e a chave determinística de idempotência.

**Files:**
- Create: migration aplicada via MCP Supabase no projeto `ubdvtjbitozhkuvvqkxj`

**Interfaces:**
- Consumes: nada
- Produces: tabelas `maria_gov_findings`, `maria_gov_known_issues`, `maria_gov_runs`, `maria_gov_probes`; ator técnico em `maria_whatsapp_atores` com `papel = 'gov_agent_tecnico'`

- [ ] **Step 1: Verificar que os nomes não colidem**

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name like 'maria_gov%';
```

Esperado: zero linhas. Se houver, **pare** — outro processo já criou algo.

- [ ] **Step 2: Aplicar a migration**

```sql
-- Ator técnico: sem ele, escrever no audit log exigiria se passar por humano (gate 1 da V1B)
insert into maria_whatsapp_atores (nome, papel, numero_hash, numero_last4, ativo, observacao)
values ('Agente de Governanca', 'gov_agent_tecnico',
        encode(digest('gov-agent-maria-v1', 'sha256'), 'hex'), '0000', true,
        'Identidade tecnica do ciclo de governanca. Nao e pessoa, nao recebe WhatsApp.')
on conflict do nothing;

create table if not exists maria_gov_findings (
  id uuid primary key default gen_random_uuid(),
  categoria text not null,
  severidade text not null check (severidade in ('alto','medio','baixo')),
  resumo text not null,
  evidencia text,
  incident_at timestamptz not null,
  assinatura text not null,
  ocorrencias int not null default 1,
  primeira_vez timestamptz not null default now(),
  ultima_vez timestamptz not null default now(),
  status text not null default 'novo',
  promoted_code text,
  auto_triage jsonb,
  verificado_em timestamptz,
  verificado_resultado text,
  verificado_nota text
);

-- Idempotência determinística (gate 2 da V1B): mesmo problema no mesmo dia não duplica
create unique index if not exists maria_gov_findings_assinatura_dia
  on maria_gov_findings (assinatura, (date_trunc('day', incident_at at time zone 'America/Sao_Paulo')));

create table if not exists maria_gov_known_issues (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  titulo text not null,
  area text,
  severidade text,
  status text not null default 'corrigido',
  causa_raiz text,
  fix_resumo text not null,
  corrigido_em timestamptz not null default now(),
  primeira_vez timestamptz,
  ultima_vez timestamptz,
  ocorrencias int not null default 1
);

create table if not exists maria_gov_runs (
  id uuid primary key default gen_random_uuid(),
  reference_date date not null,
  tipo text not null default 'gov_agent',
  status text not null,
  detalhe text,
  custo_usd numeric(10,6),
  modelo_corretor text,
  modelo_verificador text,
  modelo_efetivo_maria text,
  enviado_em timestamptz
);

create unique index if not exists maria_gov_runs_dia
  on maria_gov_runs (reference_date, tipo);

create table if not exists maria_gov_probes (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references maria_gov_runs(id),
  finding_id uuid references maria_gov_findings(id),
  pergunta_congelada text not null,
  redacao_usada text not null,
  resposta_literal text,
  sql_controle text not null,
  resultado_controle jsonb,
  veredito text,
  pass_k_total int,
  pass_k_ok int,
  modelo_verificador text not null,
  provedor_verificador text not null,
  modelo_efetivo_maria text,
  versao_protocolo text not null,
  criado_em timestamptz not null default now()
);
```

- [ ] **Step 3: Verificar o que foi criado**

```sql
select table_name,
       (select count(*) from information_schema.columns c
        where c.table_schema='public' and c.table_name=t.table_name) as colunas
from information_schema.tables t
where table_schema='public' and table_name like 'maria_gov%'
order by 1;

select papel, numero_last4, ativo from maria_whatsapp_atores where papel='gov_agent_tecnico';
```

Esperado: quatro tabelas (`maria_gov_findings` 14, `maria_gov_known_issues` 12, `maria_gov_probes` 16, `maria_gov_runs` 10) e uma linha do ator técnico.

⚠️ **Lacuna declarada:** as colunas `modelo_efetivo_maria` (em `maria_gov_runs` e
`maria_gov_probes`) nascem aqui mas **nada nesta fase as popula**. A trava 5.10 da spec — capturar
o modelo efetivo e abortar se mudou — só entra na Fatia 2, junto com o verificador. Até lá,
coluna vazia significa "não medido", nunca "não mudou". Ninguém deve assumir que a trava está de
pé porque a coluna existe.

- [ ] **Step 4: Provar a idempotência (teste que DEVE falhar na segunda inserção)**

```sql
insert into maria_gov_findings (categoria, severidade, resumo, incident_at, assinatura)
values ('teste','baixo','probe de idempotencia', now(), 'ASSINATURA-TESTE-IDEMP');

-- Esta segunda inserção TEM de falhar com unique violation:
insert into maria_gov_findings (categoria, severidade, resumo, incident_at, assinatura)
values ('teste','baixo','probe de idempotencia repetida', now(), 'ASSINATURA-TESTE-IDEMP');
```

Esperado: a segunda devolve `duplicate key value violates unique constraint`. **Se ela passar, o índice não está funcionando e o gate 2 continua aberto.**

- [ ] **Step 5: Limpar o dado de teste**

```sql
delete from maria_gov_findings where assinatura = 'ASSINATURA-TESTE-IDEMP';
```

(Único delete do plano, e é sobre linha criada pelo próprio teste.)

---

### Task 7: Função pura do placar

A ETAPA 1 do protocolo: dos KIs que o agente fechou, quantos voltaram. Função **pura** — sem banco, sem relógio — para ser testável de verdade.

**Files:**
- Create: `/home/maria/.openclaw/workspace/gov/placar-governanca.mjs`
- Test: `/home/maria/.openclaw/workspace/gov/placar-governanca.test.mjs`

**Interfaces:**
- Consumes: nada
- Produces: `calcularPlacar({ kis, findings })` → `{ fechados, reincidentes: [{codigo, vezes}], emParada: [codigo], taxa }`, e `temMarcaDoAgente(texto)` → boolean

- [ ] **Step 1: Escrever os testes que falham**

```javascript
// /home/maria/.openclaw/workspace/gov/placar-governanca.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularPlacar, temMarcaDoAgente } from './placar-governanca.mjs';

test('marca de autoria tolera sufixo dentro do colchete', () => {
  assert.equal(temMarcaDoAgente('[gov-agent] arrumei'), true);
  assert.equal(temMarcaDoAgente('[gov-agent 09/08] arrumei'), true);
  assert.equal(temMarcaDoAgente('  [gov-agent] com espaco antes'), true);
  assert.equal(temMarcaDoAgente('corrigido pelo [gov-agent] no meio'), false);
  assert.equal(temMarcaDoAgente('humano consertou'), false);
});

test('so conta KI com marca do agente', () => {
  const r = calcularPlacar({
    kis: [
      { codigo: 'A', fix_resumo: '[gov-agent] fix', corrigido_em: '2026-08-01T10:00:00Z' },
      { codigo: 'B', fix_resumo: 'humano fez', corrigido_em: '2026-08-01T10:00:00Z' },
    ],
    findings: [],
  });
  assert.equal(r.fechados, 1);
});

test('regra 1: incidente depois do fix conta como reincidencia', () => {
  const r = calcularPlacar({
    kis: [{ codigo: 'A', fix_resumo: '[gov-agent] fix', corrigido_em: '2026-08-01T10:00:00Z' }],
    findings: [{
      promoted_code: 'A', incident_at: '2026-08-05T10:00:00Z',
      auto_triage: { decision: 'regression', decided_at: '2026-08-05T11:00:00Z' },
    }],
  });
  assert.equal(r.reincidentes.length, 1);
  assert.equal(r.reincidentes[0].vezes, 1);
});

test('regra 2: triagem anterior ao fix conta mesmo com incidente antigo (corrigido_em e mutavel)', () => {
  const r = calcularPlacar({
    kis: [{ codigo: 'A', fix_resumo: '[gov-agent] reconserto', corrigido_em: '2026-08-10T10:00:00Z' }],
    findings: [{
      promoted_code: 'A', incident_at: '2026-08-02T10:00:00Z',
      auto_triage: { decision: 'regression', decided_at: '2026-08-03T10:00:00Z' },
    }],
  });
  assert.equal(r.reincidentes.length, 1);
});

test('cauda de deteccao NAO conta: incidente antes do fix e triagem depois dele', () => {
  const r = calcularPlacar({
    kis: [{ codigo: 'A', fix_resumo: '[gov-agent] fix', corrigido_em: '2026-08-10T10:00:00Z' }],
    findings: [{
      promoted_code: 'A', incident_at: '2026-08-02T10:00:00Z',
      auto_triage: { decision: 'regression', decided_at: '2026-08-11T10:00:00Z' },
    }],
  });
  assert.equal(r.reincidentes.length, 0);
});

test('duas reincidencias colocam a familia em parada', () => {
  const r = calcularPlacar({
    kis: [{ codigo: 'A', fix_resumo: '[gov-agent] fix', corrigido_em: '2026-08-01T10:00:00Z' }],
    findings: [
      { promoted_code: 'A', incident_at: '2026-08-05T10:00:00Z', auto_triage: { decision: 'regression', decided_at: '2026-08-05T11:00:00Z' } },
      { promoted_code: 'A', incident_at: '2026-08-06T10:00:00Z', auto_triage: { decision: 'regression', decided_at: '2026-08-06T11:00:00Z' } },
    ],
  });
  assert.deepEqual(r.emParada, ['A']);
});

test('finding sem triagem de regressao nao conta', () => {
  const r = calcularPlacar({
    kis: [{ codigo: 'A', fix_resumo: '[gov-agent] fix', corrigido_em: '2026-08-01T10:00:00Z' }],
    findings: [{ promoted_code: 'A', incident_at: '2026-08-05T10:00:00Z', auto_triage: { decision: 'keep', decided_at: '2026-08-05T11:00:00Z' } }],
  });
  assert.equal(r.reincidentes.length, 0);
});

test('entrada vazia nao quebra', () => {
  const r = calcularPlacar({ kis: [], findings: [] });
  assert.equal(r.fechados, 0);
  assert.equal(r.taxa, 0);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
ssh maria 'sudo -u maria node --test /home/maria/.openclaw/workspace/gov/placar-governanca.test.mjs 2>&1 | tail -6'
```

Esperado: falha com `Cannot find module './placar-governanca.mjs'`.

- [ ] **Step 3: Implementar o mínimo**

```javascript
// /home/maria/.openclaw/workspace/gov/placar-governanca.mjs
// Funcao PURA: sem banco, sem relogio. Toda I/O fica no chamador.

const RE_MARCA = /^\[gov-agent(\s[^\]]*)?\]/;
const LIMITE_PARADA = 2;

// Tolerante de proposito: o LLM escreve "[gov-agent 09/08]" e o placar
// nao pode zerar em silencio por causa disso.
export function temMarcaDoAgente(texto) {
  return typeof texto === 'string' && RE_MARCA.test(texto.trimStart());
}

function ms(valor) {
  const t = Date.parse(valor);
  return Number.isFinite(t) ? t : null;
}

export function calcularPlacar({ kis = [], findings = [] } = {}) {
  const porCodigo = new Map();
  for (const ki of kis) {
    if (!ki || !ki.codigo || !temMarcaDoAgente(ki.fix_resumo)) continue;
    porCodigo.set(ki.codigo, ki);
  }

  const contagem = new Map();
  for (const f of findings) {
    if (!f || !f.promoted_code) continue;
    const ki = porCodigo.get(f.promoted_code);
    if (!ki) continue;
    if (f.auto_triage?.decision !== 'regression') continue;

    const tFix = ms(ki.corrigido_em);
    const tInc = ms(f.incident_at);
    const tTriagem = ms(f.auto_triage?.decided_at);
    if (tFix === null || tInc === null) continue;

    // Regra 2 antes da 1: corrigido_em e MUTAVEL — um reconserto empurra o fix
    // para depois do incidente e apagaria a reincidencia que o motivou.
    const julgadaContraFixAnterior = tTriagem !== null && tTriagem <= tFix;
    if (tInc <= tFix && !julgadaContraFixAnterior) continue;

    contagem.set(f.promoted_code, (contagem.get(f.promoted_code) || 0) + 1);
  }

  const reincidentes = [...contagem.entries()].map(([codigo, vezes]) => ({ codigo, vezes }));
  const emParada = reincidentes.filter((r) => r.vezes >= LIMITE_PARADA).map((r) => r.codigo);
  const fechados = porCodigo.size;

  return {
    fechados,
    reincidentes,
    emParada,
    taxa: fechados ? reincidentes.length / fechados : 0,
  };
}
```

**Sobre a ordem das duas regras:** a regra 2 (`julgadaContraFixAnterior`) é avaliada junto com a 1 de propósito. `corrigido_em` é mutável — cada reconserto sobrescreve a data e empurra o fix para depois dos incidentes antigos. Só com a regra 1, todo reconserto apagaria a reincidência que o motivou, e `emParada` nunca dispararia. No TOM isso foi descoberto rodando contra o banco real: os dois KIs que reincidiram de verdade davam zero.

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
ssh maria 'sudo -u maria node --test /home/maria/.openclaw/workspace/gov/placar-governanca.test.mjs 2>&1 | tail -8'
```

Esperado: `pass 8`, `fail 0`.

- [ ] **Step 5: Registrar o baseline da suíte**

```bash
ssh maria 'sudo -u maria node --test /home/maria/.openclaw/workspace/gov/ 2>&1 | tail -8 | sudo tee /home/maria/.openclaw/workspace/backups/loop-maria-fase1/baseline-suite.txt'
```

Este vira o baseline conhecido — a partir daqui, "a suíte está no baseline" tem significado verificável.

- [ ] **Step 6: Backup**

```bash
ssh maria 'sudo -u maria bash /home/maria/.openclaw/workspace/scripts/backup-to-github-safe.sh --push 2>&1 | tail -3'
```

---

## Checkpoints (o que precisa ser observado antes de seguir)

| depois de | checkpoint | como se prova |
|---|---|---|
| Task 1 | laudo completo com ferramentas restritas, e caminhos de escrita baselinados | execução forçada + nove seções + `caminhos-sql-baseline.txt` não presumido |
| Task 2 | credencial do laudo é read-only de verdade | `has_table_privilege(...,'INSERT') = false` |
| Task 3 | entrega é do código e o formato sobrevive ao WhatsApp | status na API + nove seções legíveis + zero markdown cru, com olho humano |
| Task 4 | a janela quase-irreversível tem rede | **o vigia testado no caminho de FALHA**: alerta chega e o cron antigo reabilita |
| Task 5 | rotina não precisa mais de `write` | zero arquivo novo **nos diretórios do baseline**, não em diretório presumido |
| Task 6 | idempotência é real | a segunda inserção falha com unique violation |
| Task 7 | placar tem baseline | `pass 8, fail 0` gravado |

---

## Fora deste plano

As Fatias 2 a 5 da spec (sonda e verificador, loop operacional, suíte e golden-file, escada) ganham planos próprios. Cada uma depende de algo que só se sabe depois de rodar o que está aqui: o formato real dos achados persistidos, o baseline de consistência da Maria para calibrar o `pass^k`, e o comportamento do laudo já no gateway dela.
