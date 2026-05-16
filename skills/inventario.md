# Skill: Inventário (LA Report)

## Triggers (R2 — contextuais, evitar falso-positivo)

**Triggers fortes (acionam sozinhas):**
- `inventário`, `inventario`, `patrimônio`, `patrimonio`
- `lojinha`, `loja`, `estoque baixo`, `estoque da`
- Comandos: `/inv`, `/loja`

**Triggers contextuais (acionam só com 2+ termos combinados):**
- Nome de unidade (`Barra`, `Recreio`, `Campo Grande`, `CG`) + qualquer outra trigger
- Nome conhecido de sala (`Hendrix`, `Amy`, `Drum Kids`, `Studio`, `Elton John`, `Ringo`, etc) + qualquer trigger
- Verbos operacionais (`comprei`, `recebi`, `peguei`, `levei`, `chiando`, `quebrado`, `quebrou`, `falta`, `acabou`) + nome de produto/equipamento musical

**Palavras isoladas NÃO acionam** (sala, corda, baqueta, bateria) — só viram contexto se já há outra trigger.

## Comandos rápidos

| Comando | Função |
|---|---|
| `/inv` | Lista unidades disponíveis |
| `/inv [unidade]` | Lista salas com contagem de itens |
| `/inv alertas` | Resumo de alertas pendentes |
| `/loja` | Lista unidades |
| `/loja [unidade]` | Produtos + estoque por unidade |
| `/loja encomenda [unidade?]` | Lista de compra (estoque baixo) |

Os demais comandos operacionais (`add_item`, `move_item`, `maintenance`, `shop_movement`) são processados via marker JSON.

## Marker `<<INVENTORY_ACTION>>`

Quando o usuário descreve ação em linguagem natural, emita:

```
<<INVENTORY_ACTION>>
{
  "action": "add_item|move_item|maintenance|shop_movement|query_room|query_shop|query_rooms",
  "params": { ... }
}
<<END>>
```

### Schemas por action

**add_item:** `{ nome, sala_nome | sala_id, unidade_nome | unidade_id, categoria?, marca?, modelo?, quantidade?, valor_compra?, nota_fiscal?, fornecedor?, condicao? }`

**move_item:** `{ item_nome | item_id, tipo: 'entrada'|'saida'|'transferencia'|'baixa', sala_origem_nome?, sala_destino_nome?, motivo? }`

**maintenance:** `{ item_nome | item_id, tipo?: 'preventiva'|'corretiva', descricao, custo?, fornecedor_servico? }`

**shop_movement:** `{ produto_nome | produto_id, unidade_nome | unidade_id, quantidade, tipo: 'entrada'|'saida', nota_fiscal?, motivo? }`

**query_room:** `{ sala_nome, unidade_nome? }`

**query_shop:** `{ unidade_nome? }`

**query_rooms:** `{ unidade_nome }`

## Padrões de resposta

### Antes de gravar — SEMPRE confirmação inline
"Entendi: [resumo estruturado]. Confirmar?" — só executar após "sim"/"confirma"/"pode".

### Sucesso
"✅ [ação] registrada. [efeito visível]"

### Erro
"Faltou [campo]. Pode me dizer [pergunta específica]?"

## Comportamento

- **Sempre** usar contexto do snapshot `[INVENTARIO_CATALOGO]` injetado — não inventar IDs/nomes.
- **Sempre** observacoes/motivo é prefixado com `via TOM por [nome]` automaticamente pelo service — não precisa adicionar manualmente.
- Quando fuzzy lookup retornar >1 resultado, perguntar qual.
- Para fotos: pedir ao usuário se quiser anexar; baixar da UAZAPI e salvar no bucket `inventario-fotos`.
- Pesquisa de preço → encaminhar pra skill `pesquisa-preco.md`.
