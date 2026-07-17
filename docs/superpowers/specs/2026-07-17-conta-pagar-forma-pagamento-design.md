# Conta a pagar — forma de pagamento (boleto/PIX) visível e editável

**Data:** 2026-07-17
**Origem:** Alf, depois do boleto HDI funcionar no backend. O código de barras foi salvo (`pf_bills.barcode`), mas o app não tem onde mostrá-lo, e não há PIX.
**Escopo:** elevar "forma de pagamento" a cidadão de primeira classe — boleto (linha digitável) ou PIX (chave/copia-e-cola) — visível/editável no PWA e coletável pelo TOM. Continuação de `2026-07-17-boleto-conta-pagar-design.md`.

---

## O problema

O boleto funcionou: `[Boleto] conta criada ... barcode=true`, e `pf_bills.barcode` guardou a linha real (`03399745031090000927472059001015615130000099593`). **Mas o Alf olhou o app e achou que "não coletou"** — porque a tela *Editar conta* (`BillSheet.tsx`) só tem Nome, Valor, Recorrente/Única, Vencimento, Categoria. O código está no banco e o lembrete de vencimento vai entregá-lo, mas é invisível no app.

Alf: *"a gente talvez tem que expandir... colocar o código de barras ou PIX com a chave PIX. Expandir essa habilidade do TOM."*

Uma conta a pagar tem **forma de pagamento** e o modelo não expressa isso: boleto (linha digitável), PIX (chave/copia-e-cola), ou outro (débito automático).

## Goal

O Alf **vê e edita** no app o código de barras (que o TOM já coleta) e uma chave PIX; o TOM **coleta os dois** (boleto do PDF; PIX de um "copia e cola" colado ou ditado); o lembrete do dia entrega **o código da forma escolhida**. Critério: abrir a conta HDI no app e ver o código de barras com botão de copiar; mandar um PIX copia-e-cola pro TOM e ele preencher a chave.

## Decisões (Alf, 17/07)

1. **Boleto + PIX**, visíveis e editáveis no app.
2. **O TOM coleta** os dois (boleto do PDF já feito; PIX de copia-e-cola colado ou "a chave é X") **e** o Alf edita no app.
3. **Layout:** um seletor **"Forma de pagamento"** (Boleto/PIX/Outro) → mostra **um** campo (código OU chave) + botão copiar. Cada conta tem **uma** forma.
4. **Lembrete:** decide pela `payment_method` escolhida — boleto→linha digitável; pix→chave; outro→só o vencimento.

## Princípio central

**A forma de pagamento é uma escolha explícita, não uma inferência.** O lembrete e o app leem `payment_method` — não adivinham por "qual campo está preenchido". Isso evita ambiguidade (conta com barcode E pix por engano) e mantém o lembrete determinístico. E a trava de segurança do boleto se estende ao PIX: o **copia-e-cola (BR Code EMV) tem CRC16** no fim — valido igual ao dígito verificador do boleto; chave crua (email/CPF/telefone/aleatória) não tem como validar, então guardo como veio.

## Modelo de dados

`pf_bills` ganha 2 colunas (`barcode text` já existe):
```sql
alter table pf_bills add column if not exists payment_method text; -- 'boleto' | 'pix' | 'outro' | null
alter table pf_bills add column if not exists pix_key text;         -- chave PIX ou o copia-e-cola (BR Code)
```
Sem RLS nova (herda a policy). Sem CHECK no `payment_method` (mantém flexível; o front oferece só os 3 valores).

## Componentes

### 1. `src/finance/pix-parse.js` (NOVO, puro, sem I/O) — paralelo do boleto-parse

```
looksLikePixCopiaECola(text) -> boolean          // BR Code EMV: começa com '000201', tem '5204'/'5303'/'6304'
extractPixCopiaECola(text)   -> string | null     // o payload EMV limpo
validatePixBRCode(payload)   -> { valid: boolean } // confere o CRC16 (últimos 4 hex após '6304')
extractPixKeyFromText(text)  -> string | null      // "a chave pix é fulano@x" / cpf / telefone / aleatória
```
- `validatePixBRCode`: CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre o payload até e incluindo `6304`; compara com os 4 hex finais. É a trava — copia-e-cola adulterado reprova.
- `extractPixKeyFromText`: reconhece email, CPF/CNPJ (só-dígitos 11/14), telefone (+55…), chave aleatória (uuid-like) após gatilho "chave pix"/"pix é".

### 2. Backend — createBill/updateBill aceitam os campos + o TOM coleta

- `financeiro-service.js`: `createBill`/`updateBill` (ou o update existente) passam `payment_method` e `pix_key` pro `row` (paridade com o `barcode` de hoje).
- **Boleto (ajuste):** o Intercept Boleto passa a gravar `payment_method:'boleto'` junto do `barcode` já existente.
- **PIX (novo intercept no engine):** quando o texto casa `looksLikePixCopiaECola` OU `extractPixKeyFromText` **e** há uma conta a pagar em foco (recém-criada, ou nomeada: "a chave pix da HDI é…"), o TOM valida (se copia-e-cola) e grava `pix_key` + `payment_method:'pix'`. Reusa o padrão de intent/preview.
- **Editar por voz:** "muda a chave pix da conta X pra Y" → update.

### 3. Lembrete — `ritual-messages.js` decide por `payment_method`

`buildBillReminder` (modes `dia`/`atrasada`) passa a olhar `bill.payment_method`:
- `boleto` + `barcode` → `formatLinhaDigitavel(barcode)` (comportamento de hoje).
- `pix` + `pix_key` → a chave/copia-e-cola pra copiar.
- `outro`/null → só o vencimento (sem código). Mantém a paridade e não vaza código errado.

### 4. PWA — `BillSheet.tsx` (a tela Editar conta)

Segue o **design system** (CLAUDE.md): `CustomSelect`, `Field`, tokens `bg-bg-surface`/`text-fg`/`border-border`; nunca `<select>` nativo.
- Novo estado `paymentMethod` + `code` (barcode|pix_key conforme a forma).
- `<Field label="Forma de pagamento"><CustomSelect options={Boleto|PIX|Outro} …/></Field>`.
- Condicional: `boleto` → `<Field label="Código de barras">` (input + botão Copiar); `pix` → `<Field label="Chave PIX">` (input + botão Copiar); `outro` → nada.
- Botão **Copiar**: `navigator.clipboard.writeText(code)` + feedback "copiado ✓". Componente pequeno novo (`CopyButton`) ou inline.
- `lib/financeiro.ts`: o create/update do front passa `payment_method` + `barcode` + `pix_key`.

### 5. Paridade de payload (trava anti-regressão)

[[project_create_edit_payload_parity]]: o campo tem que entrar em **todos** os writers — `createBill` (service), o update do service, o `lib/financeiro` do front (create E update), e os 2 interceptors do engine (boleto + pix). Grep dos writers no plano, não de cabeça.

## Fluxo de dados

```
Boleto PDF  → engine Intercept Boleto → createBill(payment_method:'boleto', barcode) [já feito, +payment_method]
PIX copia-e-cola colado / "a chave é X" → engine Intercept PIX → valida CRC16 → updateBill(payment_method:'pix', pix_key)
App: Editar conta → seletor forma → campo código/chave + copiar → lib/financeiro update
Lembrete (dia) → olha payment_method → manda o código certo (ou só vencimento)
```

## Bordas (zero-regressão)

- **Conta antiga sem `payment_method`** → o app mostra "Outro"/vazio; o lembrete cai no comportamento de hoje (barcode se houver, senão só vencimento). Nunca quebra.
- **PIX copia-e-cola adulterado** → `validatePixBRCode` reprova → o TOM avisa, não grava chave errada.
- **Chave PIX crua** (email/CPF) → sem validação de CRC (não tem) → grava como veio; o app deixa editar.
- **`clipboard` indisponível** (http/permite) → o campo continua selecionável manualmente; o botão degrada com aviso.
- **Conta com boleto E pix por engano** → impossível pela UI (uma forma só); no backend, `payment_method` manda no lembrete.

## Testes

- **TDD** `pix-parse.js`: `looksLikePixCopiaECola` (BR Code real vs texto qualquer), `validatePixBRCode` (CRC16 certo passa; 1 char trocado reprova — a trava), `extractPixKeyFromText` (email/CPF/telefone/aleatória; ignora texto sem gatilho).
- **Fixture real:** um PIX copia-e-cola de verdade (Alf gera um) pro teste do CRC.
- **Front:** o `BillSheet` renderiza o campo certo por forma; `lib/financeiro` passa os 3 campos (teste do CRUD).
- **Zero-regressão:** suíte `finance/` + o build do PWA (`tsc --noEmit` + `vite build`) verdes; o boleto de hoje continua criando conta com `payment_method:'boleto'`.
- **Smoke real:** abrir a conta HDI no app e ver o código + copiar; mandar um PIX copia-e-cola e ver `pix_key`/`payment_method` no banco.

## Fora de escopo

- **Pagar de verdade** (regra dura).
- **Validar chave PIX crua** (email/CPF/telefone/aleatória não têm dígito verificador).
- **Múltiplas formas por conta** (uma forma só).
- **QR Code de PIX por imagem** (só copia-e-cola texto e chave por ora).

## Rollout

Validar com o **Alf** (a conta HDI + um PIX real dele) → depois **Rose** → time.

## Portão de aceite

1. App: abrir a HDI e ver o código de barras + copiar; trocar forma pra PIX e salvar uma chave.
2. TOM: colar um PIX copia-e-cola → `pix_key` + `payment_method:'pix'` no banco, CRC validado.
3. Lembrete manda o código certo pela `payment_method`.
4. Boleto de hoje intacto (suíte + build verdes; conta HDI segue com barcode).
