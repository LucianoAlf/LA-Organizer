# Auditoria de Qualidade de Conversa do TOM — Design

**Data:** 2026-06-07
**Autor:** Alf + Claude
**Status:** aprovado (brainstorming) → pronto pra plano de implementação

## Problema

A auditoria diária (health-check 05h → relatório 07h) é de **infra** ("os rituais
rodaram? markers ok? tem colaborador silencioso?"). Ela é **cega à qualidade da
conversa**: não detecta quando o TOM falha com um usuário (recusa algo que sabe
fazer, se contradiz, confabula, não processa áudio, larga um pedido). Esses erros
acontecem nos bastidores; o CEO não tem como ver (não vai olhar o tablet de todo
mundo). Resultado: o painel fica "verde / 80% OK" enquanto o usuário se frustra na
ponta — e o pessoal acaba deixando de usar.

Caso-gatilho (Matheus, 07/06): pediu o total das contas fixas do dia 10; o TOM disse
que "não tem a lista" e "não consigo salvar transações financeiras" — sendo que o
módulo financeiro existe (`pf_bills`, `pf_transactions`) e o próprio TOM **acabara de
registrar** um gasto. Contradição + recusa indevida que a auditoria das 7h não pegou.

## Objetivo

Um segundo nível de auditoria que **lê as conversas reais** e detecta **falhas do
usuário com o TOM**, normaliza em achados estruturados, persiste numa fila de triagem
e **traz no relatório das 07h** pra gente corrigir. Alta precisão (anti-ruído):
melhor 3 achados reais que 30 duvidosos.

## Decisões (fechadas no brainstorming)

1. **Onde roda:** acoplado ao ritual `daily_dream` (03h), que já lê a conversa de
   24h de cada colaborador com LLM. Sem passada de coleta nova.
2. **Onde grava:** tabela nova dedicada `tom_audit_findings` (fila de triagem),
   separada do `tom_known_issues` (ledger curado, alta confiança).
3. **O que detecta:** alta precisão, só falha clara e acionável, sempre com
   trecho-prova. 5 categorias (abaixo).
4. **Como aparece:** seção "🗣️ Qualidade das conversas" no relatório das 07h;
   linha verde quando zero.
5. **Ciclo de vida:** humano no loop sempre (achado nunca vira fix sozinho) +
   dedupe por assinatura com contador de ocorrências (recorrente fura a fila).

## Não-objetivos (YAGNI)

- Não é uma skill (skill = comportamento do TOM na conversa). É analisador de servidor.
- Não auto-corrige nem auto-promove pro `tom_known_issues`.
- Não substitui o `coach-usabilidade` (que é o toque AO VIVO, preventivo).
- Não substitui o health-check de infra — adiciona uma seção a ele.
- Sem UI no PWA nesta fase (triagem via conversa com o Claude/dev).

## Categorias de falha (taxonomia)

| key | Categoria | Reconhecer |
|---|---|---|
| `confabulation` | Confabulação / contradição | TOM afirma ter feito algo sem ter feito, ou nega capacidade que tem (caso Matheus). |
| `wrong_refusal` | Recusa indevida | Usuário pede algo que o sistema FAZ e o TOM diz que não dá. |
| `media_fail` | Mídia falha | Áudio/imagem que o TOM não conseguiu processar. |
| `dropped_request` | Pedido largado | Usuário pediu, o TOM não resolveu nem encaminhou. |
| `frustration` | Frustração explícita | "pô", "você não entendeu", "irmão", repetição da mesma demanda. |

## Arquitetura — 4 camadas

### Camada 1 — Análise (acoplada ao Dream, 03h)
- Novo módulo `src/services/conversation-audit.js`.
- Função principal: `auditConversation({ collaborator, messages })` → `Promise<Finding[]>`.
  - `messages` = a MESMA janela de 24h que o Dream já carregou em `consolidateMemoryFor`.
  - Chama o LLM (provider atual) com o prompt de qualidade.
  - Retorna lista de findings (ou `[]`). NUNCA lança — erro → `[]` + log.
- Hook no `dispatcher.js`, dentro do loop do Dream, após `consolidateMemoryFor(c)`:
  envolto em try/catch isolado (não quebra o Dream). Idempotente por dia (herda o
  gate `alreadySent(c.id, 'daily_dream', ymd)` do Dream; a auditoria roda no mesmo
  passo, então não duplica).

### Camada 2 — Detecção (prompt LLM dedicado)
- Prompt em `src/prompts/conversation-audit-prompt.js` (string pura + builder).
- Contrato de saída: JSON estrito.
  ```json
  { "findings": [
    { "category": "confabulation",
      "severity": "alto|medio|baixo",
      "summary": "<1 linha>",
      "evidence": "<trecho literal da conversa que prova>",
      "occurred_at": "<ISO ou null>" }
  ] }
  ```
- Regras do prompt (anti-ruído, inegociáveis):
  - Só emite finding com **trecho-prova literal** + **confiança alta**.
  - Na dúvida, **não emite** (lista vazia é o resultado normal e esperado).
  - Ignora conversa boa, small talk, e casos já tratados pela própria skill.
  - Não inventa: `evidence` precisa existir literalmente na conversa.

### Camada 3 — Persistência (`tom_audit_findings`)
Migration nova. Colunas:

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid PK default gen_random_uuid() | |
| `collaborator_id` | uuid FK collaborators(id) | quem viveu a falha |
| `category` | text NOT NULL | uma das 5 keys |
| `severity` | text NOT NULL | alto/medio/baixo |
| `summary` | text NOT NULL | 1 linha |
| `evidence` | text NOT NULL | trecho-prova |
| `occurred_at` | timestamptz NULL | quando na conversa |
| `signature` | text NOT NULL | dedupe (ver abaixo) |
| `status` | text NOT NULL default 'novo' | novo/confirmado/promovido/descartado |
| `occurrences` | int NOT NULL default 1 | contador de recorrência |
| `first_seen` | timestamptz NOT NULL default now() | |
| `last_seen` | timestamptz NOT NULL default now() | |
| `promoted_code` | text NULL | codigo do tom_known_issues quando promovido |
| `created_at` | timestamptz NOT NULL default now() | |

- Índice único parcial em `signature` para `status IN ('novo','confirmado')` →
  dedupe só agrupa achados ABERTOS (descartado/promovido não revive a fila).
- RLS: habilitada, service-role only (como `tom_metrics`/`marker_logs`).

**Dedupe (`signature`)** — função pura testável em `conversation-audit.js`:
`signature = sha1(category + ':' + collaborator_id + ':' + normalize(summary))`
onde `normalize` = lowercase, remove pontuação/números, colapsa espaços, corta em
~60 chars. Upsert: se existe finding aberto com a mesma `signature` →
`occurrences = occurrences + 1`, `last_seen = now()` (e mantém `status`); senão
insere novo.

### Camada 4 — Surface + triagem
- `health-check.js`: novo check `checkConversationQuality()` que NÃO chama LLM —
  só lê `tom_audit_findings` com `status IN ('novo','confirmado')` agrupado por
  categoria. Resultado vira a seção "🗣️ Qualidade das conversas" do relatório das 07h.
  - Zero achados → 1 linha verde "🗣️ 0 falhas nas conversas (24h)".
  - Com achados → lista por gravidade; recorrentes (`occurrences >= 2`) ganham 🔁 e
    sobem primeiro ("🔁 4× — …").
- `auditoria-sistema.md`: estende a skill (já é viewer) pra renderizar esses findings
  quando o Luciano perguntar "como tá a auditoria".
- Triagem (humano no loop, via conversa com o dev):
  - confirmado real → cria entrada no `tom_known_issues` + fix; marca finding
    `status='promovido'`, `promoted_code=<codigo>`.
  - falso positivo → `status='descartado'`.

## Fluxo de dados

```
03h Dream loop (por colaborador c):
  messages = carrega conversa 24h de c            (JÁ EXISTE)
  consolidateMemoryFor(c)                          (JÁ EXISTE)
  try:
    findings = auditConversation({c, messages})    (NOVO, LLM)
    for f in findings: upsertFinding(f)            (NOVO, dedupe)
  catch: log; segue                                (não quebra Dream)

05h health-check:
  checkConversationQuality() lê tom_audit_findings abertos  (NOVO, sem LLM)

07h relatório:
  seção "🗣️ Qualidade das conversas"                        (NOVO)

Triagem (sob demanda, dev):
  finding → tom_known_issues + fix (promovido) | descartado
```

## Tratamento de erro

- `auditConversation` nunca lança: LLM timeout/parse-fail → retorna `[]` + log.
- JSON malformado do LLM → tenta extrair bloco `{...}`; se falhar → `[]`.
- `upsertFinding` com erro Supabase → loga, não interrompe o loop do Dream.
- Idempotência: herda o gate diário do Dream. Re-rodar o dia (force=dream) re-analisa;
  o dedupe por assinatura evita inflar (incrementa em vez de duplicar).

## Testes

- **Unit (função pura):** `signature()` + `normalize()` + merge de dedupe — mesma
  falha gera mesma assinatura; falhas diferentes, assinaturas diferentes.
- **Smoke de precisão (caso real):** rodar `auditConversation` sobre a conversa REAL
  do Matheus (07/06) → DEVE detectar `confabulation` (contradição "não consigo salvar")
  e `wrong_refusal` (contas fixas). E sobre uma conversa boa conhecida → DEVE retornar
  `[]` (sem falso positivo).
- **Integração:** rodar o Dream com force numa janela seca e confirmar que a seção
  aparece no relatório e que zero achados rende a linha verde.

## Arquivos

- Criar: `src/services/conversation-audit.js`
- Criar: `src/services/conversation-audit.test.js`
- Criar: `src/prompts/conversation-audit-prompt.js`
- Criar: migration `tom_audit_findings`
- Criar: `scripts/smoke-conversation-audit.js` (caso Matheus)
- Modificar: `src/rituals/dispatcher.js` (hook no loop do Dream)
- Modificar: `src/rituals/health-check.js` (checkConversationQuality + seção)
- Modificar: `skills/auditoria-sistema.md` (render dos findings de qualidade)
