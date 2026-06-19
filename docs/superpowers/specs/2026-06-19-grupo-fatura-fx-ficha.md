# Spec — Parte 3-B do Grupo-CRUD: fatura/FX no grupo → oferecer ficha organizada nas anotações

**Data:** 2026-06-19 · **Status:** SPEC PRONTA, aguardando execução (Parte 3-A já entregue: `GROUPCHAT-PDF-NOREAD`). Épico: `memory/project_grupo_crud_roadmap.md`.

## Objetivo
Quando uma **fatura (PDF)** ou **arquivo FX (OFX/extrato)** cai no grupo, o TOM lê, **organiza/categoriza** (FX igual ao pessoal) e **OFERECE** salvar nas **anotações** (group_notes). NÃO mexe em finanças — o destino é a ficha do grupo.

## Decisões aprovadas (Alf 19/06)
1. **NÃO vai pra finanças de ninguém** — vai pras **anotações** (as mulheres pegam o arquivo e colocam lá).
2. **TOM lê + OFERECE** salvar organizado; cria a ficha só no "sim".
3. FX tem comportamento diferente: **categoriza** igual ao 1:1.

## Pré-requisito já entregue (3-A)
`group-chat-media.js` já lê PDF via `gemini.analyzeMedia` (texto cru). Falta: detectar fatura/OFX e produzir conteúdo ESTRUTURADO, e o fluxo de oferta→ficha.

## Arquitetura
Reaproveita 3 motores existentes: **parse** (1:1), **categorização** (1:1), **save** (GROUP_NOTE da Parte 1). Tudo no caminho async do watcher + engine do grupo. Zero finanças, zero recorrência.

### A. Detecção + parse na extração de mídia (`group-chat-media.js`)
No ramo `kind==='pdf'` (documentos), ANTES do `analyzeMedia` genérico:
- **OFX/CSV** (por `message.media_filename` terminando `.ofx`/`.csv` ou conteúdo OFX): `finance/statement-parse.statementToInvoice(buf, filename)` → lista de transações.
- **Fatura PDF**: `gemini.analyzeInvoice(buf, caption)` → `{isInvoice, invoice:{emissor, vencimento, total, itens[]}}`.
- Se fatura/OFX detectada → **categoriza** cada item (reusar `finance/categorize` ou `mapCategory` do engine — o MESMO do pessoal) e grava em `media_extracted_text` um **resumo legível** + sinaliza que é um "documento financeiro estruturado" (ex.: prefixo `[DOC_FINANCEIRO]` no media_extracted_text, ou uma coluna/flag). Guardar o JSON estruturado pra o builder determinístico (ver C).
- Senão → `analyzeMedia` genérico (já é a 3-A).
- **PDF criptografado**: porta o fluxo `finance/pdf-crypt` + `pending-pdf` (pede senha) OU degrada com aviso "esse PDF tá com senha, me manda a senha". (Pode ser fast-follow dentro da 3-B.)

### B. Oferta (prompt do grupo)
Quando o contexto traz um `[DOC_FINANCEIRO]` recém-chegado, o TOM **oferece**: "li a fatura/extrato do [emissor] — quer que eu salve organizado nas anotações?". Regra no `group-chat-prompt.js`. NÃO cria sozinho.

### C. Salvar organizado (no "sim") — builder DETERMINÍSTICO
**Crítico:** a ficha NÃO pode ser reescrita pelo LLM (risco de truncar itens — lição B1/relatórios). No "sim", um builder determinístico monta o `body`/`fields` da ficha a partir do **JSON estruturado** guardado em A (itens agrupados por categoria, total, vencimento), e cria via `createGroupNote` (Parte 1) — tipo `conta`/`livre`, título tipo "Fatura [emissor] [mês]" ou "Extrato [conta] [período]". O "sim" pode reusar o gate `group_chat_pending_confirms` (op `save_doc`) OU ser conversacional (TOM emite `<<GROUP_NOTE>>` com o conteúdo do builder). **Preferir o builder determinístico** pra preservar 100% dos itens.

## Reuso (não reimplementar)
- `gemini.analyzeInvoice`, `gemini.analyzeMedia` — parse.
- `finance/statement-parse` (`statementToInvoice`, `parseOfx`, `parseCsv`) — OFX/CSV.
- `finance/categorize` / `mapCategory` — MESMA categorização do pessoal.
- `finance/pdf-crypt` + `services/pending-pdf` — PDF com senha (se incluir).
- `createGroupNote` (group-notes.js, Parte 1) — salvar a ficha.

## Testes (TDD)
- Builder determinístico (puro): dado o JSON de fatura/OFX → body/fields da ficha agrupados por categoria, sem perder item (teste com N itens).
- Detecção OFX por filename/conteúdo (pura).
- Categorização (reusa testes do pessoal).
- Smoke ao vivo: re-processar um PDF de fatura real do grupo (há 8 de 17/06) → ver o resumo estruturado; e um OFX descartável → ver categorização; criar ficha descartável no grupo scratch e apagar.

## Não-objetivos
- Lançar no ledger financeiro / health score / estorno (Alf: finança inteira FORA).
- Upload de documento pela tela do app (hoje a mídia chega por WhatsApp; Composer só faz áudio/imagem) → **fast-follow** se precisarem mandar OFX pela tela.
- Carteira de grupo (inexistente; não se cria).

## Deploy & registro
Backend `scp`+`pm2`. Sem migration (a menos que se opte por uma flag/coluna pro `[DOC_FINANCEIRO]` — preferir prefixo no texto pra evitar migration). Known issue `GROUPCHAT-DOC-FATURA-FX`. Memórias [[project_groupchat_anotacoes_grupo]] [[project_tom_financeiro_backlog]].
