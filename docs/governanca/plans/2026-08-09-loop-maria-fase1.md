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

⚠️ **`write` FICA nesta task.** Na rodada de 09/08 o agente escreveu ~20 arquivos `.sql` para contornar `exec preflight: complex interpreter`. Removê-lo aqui quebra o laudo. Ele cai na Task 7, junto com a instalação do `superfolha_sql.py`.

**Files:**
- Modify: cron `a47a1c2b-51f9-4097-a85a-f8db87087809` no gateway do Alfredo (`HOME=/root`)
- Create: `/home/maria/.openclaw/workspace/backups/loop-maria-fase1/cron-a47a1c2b-antes.json`

**Interfaces:**
- Consumes: nada
- Produces: o mesmo cron, com `toolsAllow = ["exec","read","write"]`

- [ ] **Step 1: Snapshot do job atual**

```bash
ssh maria 'sudo mkdir -p /home/maria/.openclaw/workspace/backups/loop-maria-fase1 && \
sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 --json \
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
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 --json \
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
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 --json \
  | python3 -c "import sys,json; d=json.load(sys.stdin); s=d.get(\"state\",d); print(\"status:\",s.get(\"lastRunStatus\"),\"| entrega:\",s.get(\"lastDeliveryStatus\"),\"| diag:\",str(s.get(\"lastDiagnosticSummary\"))[:120])"'
```

Esperado: `status: ok` e `entrega: delivered`. **Atenção:** `lastRunStatus: ok` convivendo com diagnóstico de falha é conhecido e não invalida a rodada — o que invalida é seção faltando no laudo.

- [ ] **Step 7: Procedimento de reversão (só se algo acima falhar)**

```bash
ssh maria 'sudo env HOME=/root openclaw cron edit a47a1c2b-51f9-4097-a85a-f8db87087809 --clear-tools'
```

Isso devolve o comportamento anterior (todas as ferramentas). Reporte o motivo antes de tentar de novo.

- [ ] **Step 8: Registrar a conclusão**

Anexe ao relatório: a lista de tools antes e depois, e a confirmação do Step 5 e 6.

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

Anote os nomes das variáveis. Se alguma não existir em `/home/maria/.openclaw/private/maria.env`, ela precisa ser adicionada lá **com o mesmo valor** que o Alfredo usa — copie do env do root, sem imprimir o valor no terminal:

```bash
ssh maria 'sudo bash -c "grep -h \"^NOME_DA_VAR=\" /root/.openclaw/private/*.env >> /home/maria/.openclaw/private/maria.env" && echo ADICIONADA'
```

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
ssh maria 'sudo env HOME=/root openclaw cron get a47a1c2b-51f9-4097-a85a-f8db87087809 --json \
  | python3 -c "import sys,json; print(json.load(sys.stdin)[\"payload\"][\"message\"])" \
  | sudo tee /home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt | wc -c'
```

Esperado: cerca de 1801 caracteres.

- [ ] **Step 2: Descobrir o identificador do canal WhatsApp no gateway da Maria**

```bash
ssh maria 'sudo -u maria openclaw message --help 2>&1 | head -20; echo "---"; sudo -u maria openclaw cron list --json 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); [print(j.get(\"name\"), j.get(\"delivery\")) for j in d.get(\"jobs\",[])]"'
```

Anote qual `channel` o gateway da Maria reconhece. Se não houver canal WhatsApp registrado no OpenClaw dela (a bridge é externa), use o **payload de comando** em vez de `--announce` — ver Step 3b.

- [ ] **Step 3a: Criar o cron com entrega por anúncio (se houver canal WhatsApp)**

```bash
ssh maria 'sudo -u maria openclaw cron add "maria-laudo-diario-v1a-own" \
  --cron "0 7 * * *" --tz America/Sao_Paulo \
  --agent maria --session isolated \
  --tools "exec,read" \
  --message "$(sudo cat /home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt)" \
  --announce --channel whatsapp --to 5521981278047 \
  --description "Laudo diario V1A — entrega pelo WhatsApp da propria Maria" \
  --disabled'
```

Note `--disabled`: nasce desligado, liga só depois de validado (Step 5).

- [ ] **Step 3b: Alternativa se não houver canal WhatsApp no OpenClaw**

A bridge é um serviço à parte, então o gateway pode não expor `whatsapp` como canal. Nesse caso a entrega vai por comando, usando a mesma API já provada em 09/08:

```bash
ssh maria 'sudo -u maria openclaw cron add "maria-laudo-diario-v1a-own" \
  --cron "0 7 * * *" --tz America/Sao_Paulo \
  --agent maria --session isolated --tools "exec,read" \
  --message "$(sudo cat /home/maria/.openclaw/workspace/backups/loop-maria-fase1/laudo-payload.txt)" \
  --description "Laudo diario V1A — entrega pelo WhatsApp da propria Maria" \
  --disabled'
```

e a entrega é feita pelo próprio agente na última instrução do payload, acrescentando ao final do texto do `--message`:

```
ENTREGA: ao terminar o laudo, envie o texto final por WhatsApp executando:
python3 /home/maria/.openclaw/workspace/gov/enviar-whatsapp.py --to 5521981278047 --arquivo <caminho do laudo>
Não use nenhum outro canal. Se o envio falhar, diga a causa técnica no próprio laudo.
```

E crie o utilitário de envio (determinístico, sem LLM decidindo formato):

```python
# /home/maria/.openclaw/workspace/gov/enviar-whatsapp.py
import argparse, json, sys, urllib.request

def carregar_env(caminho="/home/maria/.openclaw/private/maria.env"):
    env = {}
    for linha in open(caminho):
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        k, v = linha.split("=", 1)
        env[k] = v.strip().strip('"').strip("'")
    return env

def enviar(numero, texto):
    env = carregar_env()
    url = env["MARIA_UAZAPI_URL"].rstrip("/") + "/send/text"
    corpo = json.dumps({"number": numero, "text": texto}).encode()
    req = urllib.request.Request(
        url, data=corpo,
        headers={"token": env["MARIA_UAZAPI_TOKEN"], "content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    return r.status, d.get("messageid", "")

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--to", required=True)
    p.add_argument("--arquivo", required=True)
    a = p.parse_args()
    texto = open(a.arquivo, encoding="utf-8").read()
    if not texto.strip():
        print("ERRO: arquivo vazio, nada enviado", file=sys.stderr)
        sys.exit(1)
    status, mid = enviar(a.to, texto)
    print(f"HTTP {status} messageid={mid}")
    sys.exit(0 if status == 200 else 1)
```

- [ ] **Step 4: Rodar forçado com o job ainda desabilitado**

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

**Critério de aceite:** o Alf confirma que recebeu o laudo **do número da Maria** (`5521989784688`), não do Telegram.

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

- [ ] **Step 3: Observar a rodada real das 07:00 do dia seguinte**

Este é o checkpoint da Fatia 0. No dia seguinte, confirmar com o Alf que o laudo chegou pelo WhatsApp da Maria no horário. Só então a Task 5 pode começar.

---

### Task 5: Derrubar o `write` (quitação da dívida da Task 1)

Só depois que a Task 3 estiver rodando com `superfolha_sql.py` no workspace da Maria — aí o agente não precisa mais escrever `.sql` em disco.

**Files:**
- Modify: cron novo no gateway da Maria

- [ ] **Step 1: Confirmar que a rodada anterior não usou `write`**

```bash
ssh maria 'sudo find /home/maria/.openclaw/workspace -maxdepth 1 -name "tmp_*.sql" -newermt "-2 days" 2>/dev/null | wc -l'
```

Esperado: `0`. Se houver arquivos, o agente ainda está contornando algo — **investigue antes de remover `write`**.

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
| Task 1 | laudo continua completo com ferramentas restritas | execução forçada + nove seções presentes |
| Task 4 | laudo das 07:00 chega pelo WhatsApp da Maria | confirmação do Alf + status na API |
| Task 5 | rotina não precisa mais de `write` | zero `tmp_*.sql` e laudo completo |
| Task 6 | idempotência é real | a segunda inserção falha com unique violation |
| Task 7 | placar tem baseline | `pass 8, fail 0` gravado |

---

## Fora deste plano

As Fatias 2 a 5 da spec (sonda e verificador, loop operacional, suíte e golden-file, escada) ganham planos próprios. Cada uma depende de algo que só se sabe depois de rodar o que está aqui: o formato real dos achados persistidos, o baseline de consistência da Maria para calibrar o `pass^k`, e o comportamento do laudo já no gateway dela.
