# OCR / Visão Financeira no TOM — Design

**Data:** 2026-05-31
**Status:** Aprovado (brainstorming via diálogo)

## Objetivo

Usuário manda foto (nota fiscal, comprovante, print de iFood/app) — sem precisar
escrever nada — e o TOM extrai os dados, monta um resumo e pergunta "grava?".
Confirmou → emite `register_transaction`, passando pelo resolver de fonte
(fonte-obrigatória). Substitui "fiz uma compra no iFood" por "só printo e mando".

## Contexto / infra existente (reaproveitada)

O pipeline de imagem **já existe** (`webhook.js:151-183`):
imagem → `audio.downloadMediaFromUazapi` (UAZAPI) → `vision.analyzeImage`
(OpenAI, `vision.js`) → descrição textual injetada como `text` na conversa →
engine → system prompt + skills → Claude.

Ou seja: a foto **já vira contexto textual** que o Claude lê. O gap é (1) a
descrição atual é genérica (4 frases) e pode perder número pequeno, e (2) a
skill financeira não sabe transformar um comprovante em lançamento.

**Não há pipeline novo.** São 3 arquivos: prompt de visão, skill, regex de skill.

## Arquitetura

### 1. `vision.js` — prompt enriquecido (1 chamada, sem custo extra de rota)
O prompt compartilhado passa a instruir: **SE** a imagem for nota fiscal,
comprovante, recibo ou tela de compra de app, além da descrição, extrair e
transcrever **literalmente**:
- valor total (R$)
- estabelecimento / loja / app
- data (se visível)
- forma de pagamento (crédito, débito, PIX, dinheiro, nome do cartão/banco)
- itens principais (resumido)

E prefixar a saída com o sinal literal `COMPROVANTE FINANCEIRO:` quando detectar.
Imagem não-financeira → descrição normal, sem o prefixo, comportamento inalterado.

Transcrição literal de números é obrigatória (não arredondar, não inferir).

### 2. `system.js` — `FINANCE_RE` carrega a skill em foto sem legenda
Foto sem legenda não tem palavra-chave financeira. Como o prompt enriquecido
marca comprovantes com `COMPROVANTE FINANCEIRO:` + valores `R$`, adicionar ao
`FINANCE_RE`: `comprovante|nota fiscal|R\$\s*\d`. Garante que a skill
`financeiro-pessoal` é injetada quando a descrição da imagem indica um recibo.

**Atenção:** o sinal sai em maiúsculas (`COMPROVANTE FINANCEIRO:`). O `FINANCE_RE`
deve casar case-insensitive (flag `i`) — verificar no plano se o regex atual já
tem a flag; se não, adicionar sem quebrar os outros termos.

### 3. `financeiro-pessoal.md` — seção "Interpretação de comprovante"
Quando a conversa contém uma descrição com `COMPROVANTE FINANCEIRO:`, o TOM:
1. Extrai valor, estabelecimento, categoria (mapeada do estabelecimento), forma
   de pagamento e data.
2. Monta um resumo curto e pergunta **"grava?"**:
   `🧾 Posto Shell — R$180, débito, transporte, hoje. Grava?`
3. Só emite `register_transaction` **após** o usuário confirmar.
4. Valor ilegível / ausente → pede pra digitar, **não chuta**.
5. Valor único por comprovante (total + categoria) — **não itemiza** notas.

## Integração com a fonte-obrigatória (modelo revisado: app = fonte de verdade)

O OCR **só pré-preenche um rascunho**. O `register_transaction` emitido passa
pelo **mesmo resolver de fonte** que o outro chat está implementando — e segue o
mesmo modelo revisado (cadastro é no app, WhatsApp só lança):
- forma de pagamento = nome de cartão ou "crédito"/"parcelei" → **compra na fatura**
- fonte explícita no comprovante (banco/conta) → usa
- sem fonte + **conta principal** cadastrada → usa a principal, silencioso
  (a confirmação mostra a fonte)
- sem fonte + várias contas sem principal → **pergunta** (pending-state)
- **0 contas cadastradas → NÃO grava** → devolve a mensagem-coach (P6):
  "li teu comprovante (Posto Shell R$180), mas pra gravar certo cadastra tua
  conta no app primeiro — Finanças → Carteiras. Lá é a fonte de verdade."

**O OCR nunca fura a regra de fonte e nunca improvisa cadastro por chat.** Mostra
o que extraiu (bom UX), mas só grava quando há fonte resolvível. Setup é no app.

### Sequência de entrega
Depende do resolver de fonte aterrissar (outro chat). Até lá, o OCR funcionaria
com o tratamento de fonte antigo (bugado). Portanto **OCR entra junto/depois da
fonte-obrigatória**, nunca antes.

## Fluxo de dados (ponta a ponta)

1. Usuário envia foto (sem legenda necessária).
2. Webhook baixa + `vision.analyzeImage` (prompt enriquecido) → descrição com
   `COMPROVANTE FINANCEIRO:` + campos entra como texto.
3. `FINANCE_RE` casa → skill financeira carrega.
4. Claude monta resumo + pergunta "grava?".
5. Usuário: "isso" / "não, foi 200" (correção) / "no nubank" (fonte).
6. Confirmou → `register_transaction` → resolver de fonte → grava.

## Confirmação (alinhada ao pending-state)

O rascunho do comprovante vive na conversa; ao confirmar ("isso"), o LLM re-emite
`register_transaction` com os dados. Correção ("não, foi 200") é conversa natural
antes de gravar. Quando o engine precisar perguntar a fonte (várias contas sem
principal), reusa o **pending-state** do outro chat (mesmo mecanismo da pergunta
de fonte digitada) — imune a timeout/fabricação. OCR não inventa estado próprio.

## Tratamento de erro

- Download falha → fallback atual ("não consegui baixar, tenta de novo").
- Não é comprovante → imagem tratada normal, sem forçar lançamento.
- Provider de visão caído → fallback atual ("descreve em texto").
- Valor ilegível → TOM pede o valor, não grava.

## Fora de escopo (v1)

- Guardar a imagem do comprovante (storage/anexo) — fast-follow se sentir falta.
- Itemizar notas (valor por item) — v1 é valor único.
- PDF de comprovante — `vision.js` já não suporta PDF inline (fallback educado).

## Testes (smoke WhatsApp)

1. Foto de comprovante de **cartão de crédito** → propõe **na fatura**.
2. **Print de iFood** com conta principal cadastrada → propõe despesa
   alimentação na principal, silencioso.
3. Foto de **nota de posto (débito)**, várias contas sem principal → **pergunta**
   qual conta (pending-state).
4. **0 contas cadastradas** → mostra o que extraiu + **coach pro app** (não grava).
5. **Foto não-financeira** (cachorro) → não força lançamento.
6. **Correção**: "não, foi 200" → ajusta antes de gravar.
7. **Confirmação obrigatória**: nada grava sem "grava?" respondido.
8. Foto com **valor ilegível** → TOM pede pra digitar.

## Arquivos

- `src/services/vision.js` — prompt enriquecido + sinal `COMPROVANTE FINANCEIRO:`
- `src/prompts/system.js` — `FINANCE_RE` += comprovante/nota/R$
- `skills/financeiro-pessoal.md` — seção "Interpretação de comprovante"
- Zero migration, zero schema.
