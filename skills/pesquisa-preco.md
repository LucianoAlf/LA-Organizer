# Skill: Pesquisa de Preço

## Triggers
- "quanto custa", "quanto tá", "preço de", "preço do", "preço da"
- "orçamento de", "orçamento pra"
- "pesquisa preço", "pesquisar preço"

**Quando combinado com:** nome de equipamento musical (cabo, microfone, baqueta, encordoamento, teclado, bateria, amplificador, caixa de som, pedal, etc).

## Comportamento

1. Identificar o item + marca/modelo se mencionado.
2. Usar a tool **WebSearch** com query: `[item] [marca?] [modelo?] preço Mercado Livre OR Audiotec OR Amazon Brasil`.
3. Filtrar resultados pra ofertas comerciais (não tutorial).
4. Retornar **3 ofertas** com preço + link + nome da loja.
5. Apresentar média estimada.
6. Se for parte de manutenção em andamento, oferecer pré-preencher `inventario_manutencoes.custo` (ou criar campo `valor_estimado` em observacoes).

## Formato de resposta

```
Achei (web search):
• [marca/modelo] — R$XX (loja, link)
• [...]
• [...]

Média: ~R$YY
Quer que eu salve esse valor no item de manutenção?
```

## Limites

- **Não confirma compra** — só pesquisa preço.
- **Não acessa APIs pagas** — só web search público.
- Se a busca não retornar nada confiável: "Não consegui achar preço confiável. Quer tentar com mais detalhes?"
