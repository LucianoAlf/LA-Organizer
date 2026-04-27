---
name: gestao-memoria
description: Extração ativa de memória durante a conversa. Quando o colaborador revelar algo digno de lembrar, anexe um marcador <<MEMORY_SAVE>> no FINAL da mensagem. O engine remove o bloco antes de enviar — o colaborador NUNCA verá.
---

# Gestão de Memória (extração ativa)

## Quando salvar
Quando, na mensagem atual ou na conversa recente, o colaborador revelou um fato durável, decisão tomada, lição aprendida, preferência clara, ou contexto pessoal/profissional relevante.

Heurística: **"Daqui a 2 meses isso ainda importa?"** Se sim, salve.

## Regra de economia
Prefira 1 memória boa a 4 memórias óbvias.
Não transforme toda conversa em extração. Salve o que tem valor futuro real.

## Quando NÃO salvar
- Bate-papo, saudação, "tá bom", "fechou", emoji solto
- Coisas óbvias do perfil/role já registrado
- Estado momentâneo ("tô cansado hoje" — só vira memória se virar padrão)
- Qualquer coisa já presente na lista de "Memória relevante" do system prompt (evite duplicata)

## Formato do marcador (OBRIGATÓRIO no final)
Quando houver algo a salvar, sua resposta termina EXATAMENTE com este bloco — depois dele NADA:

```
<<MEMORY_SAVE>>
[
  {"memory_type":"fact","content":"<fato curto, neutro, terceira pessoa>","importance":"normal"},
  {"memory_type":"preference","content":"<preferência clara>","importance":"normal"}
]
<<END>>
```

- `memory_type` DEVE ser um destes: `fact` | `decision` | `lesson` | `preference` | `context`
- `importance` DEVE ser um destes: `critical` | `high` | `normal` | `low`
- `content`: 1 frase curta, escrita em terceira pessoa, neutra. Ex.: "Luciano está gravando disco de bossa nova com previsão para junho/2026."
- Pode incluir 1 ou vários itens no array. Mínimo 1.

## Regras de ouro
- O marcador é SEMPRE a última coisa da resposta. Nada de texto depois do `<<END>>`
- Antes do marcador vai a resposta normal pro colaborador (que NÃO menciona o marcador)
- Se NÃO há nada digno de salvar, OMITA o bloco inteiro. Não emita marcador vazio
- Não duplique memória já listada no contexto

## Mapeamento de tipos

| Tipo | O que é | Exemplo | Expira? |
|---|---|---|---|
| `fact` | Fato concreto | "Toca violão há 20 anos, mora no Recreio" | Não |
| `decision` | Decisão tomada | "Decidiu pausar projeto X até agosto" | Não |
| `lesson` | Padrão aprendido | "Evitar agendar reunião na sexta após 17h" | Não |
| `preference` | Preferência clara | "Prefere reuniões curtas de 15min" | Não |
| `context` | Situação temporária | "Filha nasceu em março/2026, dormindo pouco" | Sim — sempre definir `decay_at` |

### Nota sobre `context`
É o tipo mais propenso a expirar. Sempre que salvar um `context`, defina um prazo realista de relevância. Exemplos: evento em junho → decay em julho; projeto com prazo → decay após entrega.

## Veto
- NUNCA mostre o marcador na conversa visível
- NUNCA invente fato — se a inferência exige adivinhar, não salve
- NUNCA salve fofoca ou julgamento sobre terceiros
- NUNCA salve o óbvio — só o que tem valor futuro real
