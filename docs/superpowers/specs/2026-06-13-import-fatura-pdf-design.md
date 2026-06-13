# Import de Fatura por PDF → Financeiro/Anotações — Design

**Data:** 2026-06-13
**Origem:** ideia do Alf + pedido recorrente da Rose ("manda o PDF da fatura e me devolve a lista pra eu lançar").
**Status:** design aprovado no brainstorm; aguardando revisão do spec antes do plano.

## Objetivo
Transformar a leitura de PDF de fatura (que hoje só vira texto/resumo solto) em **ação estruturada**: o TOM extrai os lançamentos, pergunta o destino e **lança no financeiro** (compras no cartão) ou **salva como anotação** — com preview e confirmação antes de gravar.

## Pré-requisitos (JÁ ENTREGUES em 13/06)
- **Extração completa de mídia** (`TOM-MEDIA-OUTPUT-TRUNCATED-1024`): `maxOutputTokens` 8192 + prompt "liste tudo, não resuma". Sem isso a fatura vinha cortada no item ~30. Validado com 45 itens.
- **TOM sabe que lê mídia** (`TOM-PDF-CAPABILITY-DENIED`): prompt informa a capacidade de PDF/imagem/vídeo/áudio.

## Decisões (do brainstorm)
1. **Destino:** TOM pergunta na hora — "lanço no financeiro ou salvo nas anotações?".
2. **Confirmação (financeiro):** preview do lote + **1 OK** (não item-a-item, não automático).
3. **Anotações:** anotação **pessoal simples** (nota com a lista formatada). Ficha tipada = evolução futura.
4. **Estruturação:** o **Gemini retorna JSON** (vê o PDF real) — não o Claude re-parseando texto (evita item inventado / valor errado).

## Fluxo
1. Usuário manda o PDF (webhook já baixa + chama o Gemini).
2. **Detecção + estruturação:** quando o conteúdo parece fatura (palavras "fatura/vencimento/total"), o Gemini devolve JSON:
   `{ emissor, vencimento, total, itens: [{ descricao, valor, data, parcela_atual, parcela_total, tipo }] }`.
3. O engine guarda os itens num **pending-intent `invoice_import`** (TTL) e o TOM pergunta o destino:
   *"📄 Fatura do **Itaú** — 40 compras, total R$ X (vence 15/06). Lanço no **financeiro** ou salvo nas **anotações**?"*
4. **Se financeiro:**
   - Casa o cartão pelo emissor (reusa `findCard`; se não achar/ambíguo → pergunta "de qual cartão?").
   - Categoriza cada item (reusa `categorize.js`).
   - Monta **preview**: lista (item · valor · data · parcela · categoria) + cartão + total + **aviso de possíveis duplicatas** → *"confirmo os N lançamentos?"*.
   - No OK → lança em lote (reusa `createCardPurchase` por item; competência/parcelas conforme a fatura).
5. **Se anotações:** cria nota pessoal com a lista formatada + total/vencimento.

## Componentes
**Novos:**
- `gemini.js`: modo "fatura" → `analyzeInvoice(buf)` que pede JSON estruturado (separado do `analyzeMedia` genérico).
- Detecção de fatura (webhook ou engine): heurística por palavras-chave no texto extraído.
- Marker/ação `<<INVOICE_IMPORT>>` no engine: orquestra destino → preview → confirmação → lote.
- Pending-intent `invoice_import` (itens + cartão resolvido + estado).
- Builder de preview **puro e testável** (monta a mensagem de confirmação a partir do JSON).

**Reusa:** `findCard`, `categorize.js`, `createCardPurchase`, padrão de pending-intent existente, criação de anotação pessoal.

## Casos de borda
- **Não é fatura** → cai no resumo normal de hoje (nada muda).
- **Cartão não identificado** → TOM pergunta qual.
- **Possível duplicata** (fatura já lançada) → avisa no preview antes de confirmar.
- **Item sem data** → usa a data da fatura.
- **Usuário desiste no preview** → pending-intent expira; nada é gravado.
- **JSON do Gemini malformado** → fallback pro resumo em texto (não quebra).

## Fora de escopo (YAGNI / futuro)
- Outros documentos (boleto, comprovante, nota fiscal) → anotações/inventário.
- Ficha tipada na base de conhecimento (por ora, anotação pessoal simples).
- Conciliação automática com fatura já paga / dedup avançado (v1 só **avisa** no preview).
- Edição item-a-item dentro do preview (v1 é tudo-ou-nada; a pessoa ajusta depois no app).

## Validação
- **Unit:** parser do JSON da fatura, matching de cartão, builder de preview.
- **E2E na VPS:** PDF de fatura real → JSON → preview → confirma → lançamentos no banco (cartão certo, parcelas, categorias).
- **Smoke** de extração já existe: `scripts/smoke-fatura-pdf.js`.
