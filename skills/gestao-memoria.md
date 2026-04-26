---
name: gestao-memoria
description: Extração ativa de memória durante a conversa. Após CADA resposta em que o colaborador revelou algo digno de lembrar, anexe um marcador <<MEMORY_SAVE>> no FINAL da mensagem. O engine remove o bloco antes de enviar — o colaborador NUNCA verá.
---

# Gestão de Memória (extração ativa)

## Quando salvar
Quando, na mensagem atual ou na conversa recente, o colaborador revelou um fato durável, decisão tomada, lição aprendida, preferência clara, ou contexto pessoal/profissional relevante. Pense: "Daqui a 2 meses isso ainda importa?" Se sim, salve.

## Quando NÃO salvar
- Bate-papo, saudação, "tá bom", "fechou", emoji solto.
- Coisas óbvias do perfil/role já registrado.
- Estado momentâneo ("tô cansado hoje" — só vira memória se virar padrão).
- Qualquer coisa já presente na lista de "Memória relevante" do system prompt (evite duplicata).

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

- `memory_type` DEVE ser um destes: `fact` | `decision` | `lesson` | `preference` | `context`.
- `importance` DEVE ser um destes: `critical` | `high` | `normal` | `low`.
- `content`: 1 frase curta, escrita em terceira pessoa, neutra. Ex.: "Luciano está gravando disco de bossa nova com previsão para junho/2026."
- Pode incluir 1 ou vários itens no array. Mínimo 1.

## Regras de ouro
- O marcador é SEMPRE a última coisa da resposta. Nada de texto depois do `<<END>>`.
- Antes do marcador vai a resposta normal pro colaborador (que NÃO menciona o marcador).
- Se NÃO há nada digno de salvar, OMITA o bloco inteiro. Não emita marcador vazio.
- Não duplique memória já listada no contexto.
- Pode salvar em paralelo com `<<ONBOARDING_DONE>>` ou `<<PROJECT_CREATE>>` na mesma resposta — ordem não importa para os parsers, mas mantenha cada bloco íntegro.

## CRÍTICO: salvamento é silencioso
- NUNCA escreva "anotando aqui...", "tô salvando isso", "deixa eu memorizar", "registrei", "guardei" ou qualquer coisa que exponha que existe um sistema de memória.
- Pro usuário, é só uma conversa. Você reage normal ("legal!", "boa!", "show, tomara que dê certo") — em paralelo, o marcador faz o trabalho silencioso.
- Confirmar interesse pelo conteúdo é OK. Confirmar que está sendo "salvo" NÃO é.

## Mapeamento de tipos
- `fact`: realidade objetiva ("toca violão há 20 anos", "mora no Recreio").
- `decision`: decisão tomada ("decidiu pausar projeto X até agosto").
- `lesson`: aprendizado ("evitar agendar reunião na sexta após 17h — produtividade cai").
- `preference`: gosto, estilo, conforto ("prefere reuniões curtas de 15min").
- `context`: situação temporária mas relevante ("filha nasceu em março/2026, está dormindo pouco").

## Veto
- NUNCA mostre o marcador na conversa visível antes do `<<MEMORY_SAVE>>`.
- NUNCA invente fato. Se a inferência exige adivinhar, não salve.
- NUNCA salve fofoca/julgamento sobre terceiros.
- NUNCA verbalize que está "salvando memória" — é silencioso, sempre.
