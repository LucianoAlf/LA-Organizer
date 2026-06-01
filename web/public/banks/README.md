# Logos de banco (SVG) — onde colocar e como nomear

Coloque os SVGs das marcas dos bancos **nesta pasta**: `web/public/banks/`.

Por estar em `public/`, cada arquivo fica acessível pela URL `/banks/<slug>.svg`
(ex.: `web/public/banks/nubank.svg` → `https://app/banks/nubank.svg`). O app monta
a `<img src="/banks/<slug>.svg">` a partir do `bank_slug` escolhido na carteira.

## Convenção de nome do arquivo
- **`<slug>.svg`** — tudo minúsculo, sem espaço/acento, ASCII. Um arquivo por banco.
- O `slug` é o identificador estável (vai pro banco de dados em `pf_accounts.bank_slug`).

## Slugs recomendados (use estes; se faltar algum, crie no mesmo padrão)
| Banco | arquivo |
|---|---|
| Nubank | `nubank.svg` |
| Itaú | `itau.svg` |
| Bradesco | `bradesco.svg` |
| Santander | `santander.svg` |
| Banco do Brasil | `bb.svg` |
| Caixa | `caixa.svg` |
| C6 Bank | `c6.svg` |
| Inter | `inter.svg` |
| Banco Original | `original.svg` |
| Next | `next.svg` |
| Neon | `neon.svg` |
| PicPay | `picpay.svg` |
| Mercado Pago | `mercadopago.svg` |
| BTG Pactual | `btg.svg` |
| Sicoob | `sicoob.svg` |
| Sicredi | `sicredi.svg` |
| Safra | `safra.svg` |
| PagBank | `pagbank.svg` |
| Will Bank | `will.svg` |
| Banco Pan | `pan.svg` |

## Recomendações do arquivo SVG
- **Símbolo/marca quadrado** (não o logotipo horizontal comprido) — renderiza melhor no tile/círculo.
- **Fundo transparente.** `viewBox` quadrado (ex.: `0 0 64 64`).
- Tamanho do arquivo pequeno (otimizado). Pode ser o "ícone" do app do banco.

## Catálogo (cor + nome) — fica no código
O nome amigável e a **cor da marca** de cada banco ficam em `web/src/lib/banks.ts`
(mapa `slug → { name, color }`). Ao escolher o banco na carteira, o app já preenche
**logo + cor**. Carteiras sem banco (ex.: Dinheiro) seguem usando emoji + cor escolhida.
