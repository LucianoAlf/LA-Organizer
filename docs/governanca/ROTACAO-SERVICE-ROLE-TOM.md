# 🔑 Trocar a chave mestra do TOM — procedimento de 1 página

**Por que:** a chave que abre o banco do TOM inteiro está num arquivo antigo do repositório
`LA-Organizer`, baixável **sem login** enquanto o repo estiver público, e **continua válida**
(HTTP 200 medido em 13/08/2026). Tornar o repo privado **não resolve**: quem já baixou, tem.

**A boa notícia (medida em 13/08):** o projeto do TOM já está no sistema NOVO de chaves do Supabase
(existe uma `sb_publishable_…` ativa). Isso permite trocar **só a chave mestra**, sem mexer na chave
pública que o app usa — ou seja, **o PWA não cai**.

> Rotação do "JWT secret" faria as duas de uma vez e derrubaria o app. **Não é esse o caminho.**

---

## Quem consome a chave mestra hoje (inventário conferido)

| onde | o quê | quem atualiza |
|---|---|---|
| `/opt/LA-Organizer/.env` | engine do TOM — **único consumidor vivo** | eu |
| 4 Edge Functions | leem `SUPABASE_SERVICE_ROLE_KEY` do ambiente do Supabase | eu |
| dentro do banco | **nada** — sem cron, sem webhook, sem trigger | — |
| PWA (Vercel) | usa a chave **pública**, não a mestra | não mexe |

---

## Passo a passo

**1. Alf, no painel do Supabase** (projeto `cesnbnrynvxvgdhfmaua` → Settings → API Keys → *Secret
keys*): **criar uma secret key nova**. Só criar — **não revogar nada ainda**. Me mandar a chave por
canal privado (não por este chat).

**2. Eu:** troco no `.env` do TOM, troco nas 4 Edge Functions, reinicio e **provo** que o TOM lê e
escreve normalmente (leitura de colaboradores + uma escrita real de teste).

**3. Só depois de provado, Alf:** **desabilitar a chave legacy `service_role`** no mesmo painel.
É este passo que fecha o vazamento — os anteriores só preparam o terreno.

**4. Eu:** confirmo que a chave vazada passou a responder **401** e registro a prova no painel.

**Rollback:** enquanto o passo 3 não acontecer, a chave antiga continua valendo — basta devolver o
`.env` do backup e reiniciar. Depois do passo 3 não há rollback, e é por isso que a prova do passo 2
vem antes.

---

## O que já foi feito sem depender de ninguém (13/08)

**A senha do webhook do TOM já foi trocada.** Era um dos 9 segredos do arquivo vazado; agora o valor
público não serve mais para nada:

| rota | resposta |
|---|---|
| URL nova | **HTTP 200** — `auth ok (mode=strict, method=url_token)` no log |
| URL antiga (a que está no repo) | **HTTP 401** — `REJECT — auth url_token_mismatch` |

Feito sem janela de surdez perceptível: a UAZAPI **substitui** o webhook em vez de aceitar dois (isso
foi descoberto na hora, não presumido), então a troca do `.env` e o restart vieram em seguida
imediata, e a rota nova foi provada pelo log antes de encerrar.

---

## Os outros 7 segredos do arquivo vazado

| segredo | quem pode trocar | estado |
|---|---|---|
| `WEBHOOK_SECRET` | eu | ✅ **trocado 13/08** |
| `SUPABASE_SERVICE_ROLE_KEY` | Alf cria, eu aplico | 🔶 este documento |
| `UAZAPI_TOKEN` | Alf (painel UAZAPI) | 🔶 aberto — permite mandar WhatsApp **como o TOM** |
| `SUPABASE_URL`, `UAZAPI_URL`, `TOM_PHONE`, `PORT`, `NODE_ENV`, `LOG_LEVEL` | — | não são segredos |

**Ordem de gravidade:** a chave mestra (lê e escreve tudo) vem primeiro; o token da UAZAPI (fala como
o TOM no WhatsApp) vem logo atrás.
