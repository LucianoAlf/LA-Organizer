---
name: cadastro-projeto-5w2h
description: Conduz cadastro de projeto via conversa de 7 perguntas (5W2H), uma por mensagem. Ao confirmar, emite marcador <<PROJECT_CREATE>> que o engine persiste. Só coordenador ou diretor pode disparar.
---

# Cadastro de Projeto (5W2H)

## Trigger
O colaborador disse algo como: "quero criar projeto", "novo projeto", "vamos criar um projeto", "cadastra um projeto", "preciso cadastrar um projeto", ou descreveu intenção clara equivalente.

## Gate de permissão (PRIMEIRA COISA)
Olhe o `Role` do colaborador no contexto:
- `coordinator` ou `director` → siga o fluxo abaixo.
- `collaborator` ou `leader` (ou qualquer outra) → responda EXATAMENTE:
  > "Só coordenador ou diretor pode criar projeto. Quer que eu avise alguém?"
  E PARE. Não faça nenhuma pergunta. Não emita marcador.

## Fluxo — 7 perguntas, UMA por mensagem (na ordem)
Não despeje tudo de uma vez. Espere a resposta antes de fazer a próxima.

1. **What** — "Como vai chamar esse projeto?" → captura `name`.
2. **Why** — "Por que esse projeto existe? Qual a justificativa?" → captura `justification`.
3. **Where** — "Onde vai acontecer? Qual unidade ou local?" → captura `location` (texto livre: campo_grande / recreio / barra / online / etc).
4. **When** — "Qual a janela? Início e fim (datas ou 'a definir')?" → captura `start_date` e `end_date`. Parse pra ISO `YYYY-MM-DD` quando der; se a pessoa disser "a definir" / "ainda não sei", use `null`.
5. **Who** — "Quem participa? Pode ser por nome ou função." → guarda como texto em `description` (membros formais entram depois).
6. **How** — "Como vai executar? Qual a metodologia ou abordagem?" → captura `methodology`.
7. **How much** — "Quanto de horas por semana esse projeto vai consumir do time, em média?" → captura `estimated_hours_week` (número inteiro).

## Confirmação
Depois das 7 respostas, recapitule TUDO em uma mensagem:
> "Confere se tá certo:
> - Nome: ...
> - Justificativa: ...
> - Local: ...
> - Janela: ... → ...
> - Quem: ...
> - Metodologia: ...
> - Horas/semana: ...
> Posso criar?"

## Resposta do colaborador
- Se confirmar ("sim" / "pode" / "manda" / "fechou" / "cria" / equivalente): emita o marcador final (abaixo).
- Se pedir alteração ("muda o nome pra X"): ajuste o campo, repita a confirmação. Loop até confirmar.
- Se cancelar ("cancelar" / "deixa pra lá" / "esquece"): aborte sem marcador. Confirme em texto: "Beleza, cancelei aqui. Quando quiser, é só chamar."

## Marcador final (OBRIGATÓRIO ao confirmar)
A resposta termina EXATAMENTE com este bloco — sem texto depois:

```
<<PROJECT_CREATE>>
{
  "name": "Sarau de Violinos",
  "description": "Jordão lidera; equipe pedagógica de Recreio.",
  "justification": "Celebrar 14 anos da escola.",
  "location": "recreio",
  "start_date": "2026-06-01",
  "end_date": "2026-07-30",
  "methodology": "Ensaios semanais + apresentação final",
  "estimated_hours_week": 5,
  "category": "operational"
}
<<END>>
```

- Antes do marcador vai uma frase curta tipo "Fechou, criando agora..." (sem prometer ID — o engine adiciona depois).
- `category`: tente inferir entre `pedagogical` | `commercial` | `administrative` | `operational` | `event` | `infrastructure`. Se não tiver certeza, use `operational`.
- `start_date` / `end_date`: ISO `YYYY-MM-DD` ou `null`.
- `estimated_hours_week`: número (inteiro ou decimal). Sem aspas.
- `description`: cole aqui a resposta da pergunta 5 (Who).

## Veto
- NUNCA pule o gate de permissão.
- NUNCA emita o marcador antes da confirmação final.
- NUNCA despeje as 7 perguntas de uma vez.
- NUNCA invente respostas — se a pessoa não respondeu, pergunte de novo.
- NUNCA mostre o marcador na conversa visível antes da confirmação.
