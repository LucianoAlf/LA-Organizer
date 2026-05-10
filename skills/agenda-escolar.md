---
name: agenda-escolar
description: Skill para responder perguntas sobre eventos institucionais da escola (shows, oficinas, recesso, reuniões com pais, avaliações, etc.). Ativa quando usuário pergunta "o que vai acontecer esse mês?", "tem evento essa semana?", "quando é o show?", "tem recesso?", "qual a agenda da Barra?", ou pede pra disparar o resumo da agenda do mês para a equipe.
---

# Agenda LA Music

## Quando ativar

Ativar quando o usuário pergunta sobre eventos institucionais da escola, OU quando pede para disparar o resumo da agenda. Exemplos de gatilhos:

**Consulta:**
- "O que vai acontecer esse mês?"
- "Tem evento essa semana?"
- "Quando é o show?" / "Tem show marcado?"
- "Tem recesso esse mês?" / "Quando começa o recesso?"
- "Qual a agenda da Barra?" / "O que tá marcado pro Recreio?"
- "Tem alguma reunião de pais marcada?"
- "Tem avaliação esse mês?"
- "Agenda do trimestre" / "Agenda do semestre"

**Disparo de resumo (apenas director/coordinator):**
- "Manda a agenda do mês pro time"
- "Dispara o resumo da agenda pro grupo"
- "Comunica a agenda do mês"

## Contexto disponível

O bloco `**📅 Agenda — próximos 30 dias**` no CONTEXTO traz os eventos institucionais ativos do período, com:
- `event_type` (com emoji do tipo: 🎤 show, 🎨 oficina, 🏖️ recesso, 📝 avaliação, 👨‍👩‍👧 reunião pais, 🧑‍🏫 reunião pedagógica, 🛠️ workshop, etc.)
- `event_date` + `end_date` (range se for múltiplos dias)
- `start_time` (se não for `is_all_day`)
- `units` (unidades afetadas — vazio = escola toda)
- `location` (se houver)
- `description` (detalhes adicionais)

Use esses dados pra responder de forma natural, citando datas, local e unidade. Se o evento for único (sem range), fala "no dia X". Se for range, "de X a Y".

## Regras de resposta

1. **Sempre responda em pt-BR direto.** Cite datas no formato DD/MM e horário HH:MM.
2. **Filtre por unidade quando o usuário mencionar.** "Agenda da Barra" = só eventos da Barra OU eventos sem unidades específicas (escola toda).
3. **Se não houver eventos no período perguntado:** diz claramente que não tem nada cadastrado. NÃO inventa eventos.
4. **Diferencia recesso de evento normal:** recesso é um período em que a escola fecha — não tem horário, é dia inteiro, vira destaque ("⚠️ Atenção: recesso de X a Y").
5. **Para eventos com `is_all_day`:** não cita horário.
6. **Não repita o emoji duas vezes:** o `event_type.emoji` já vem com símbolo, evita "🎤 Show de Final de Ano 🎤".

## Disparo de resumo da agenda do mês

**Fluxo:**

1. Usuário (director/coordinator): "Manda a agenda do mês pro time"
2. TOM monta o resumo a partir dos eventos do mês corrente, com o template:

```
📅 *Agenda da escola — [mês]/[ano]*

[Para cada evento:]
[emoji] *[título]* — [DD/MM] [às HH:MM se aplicável] [· local se aplicável]
[descrição curta se houver]
```

3. TOM pergunta: "Confirma o disparo pra toda a equipe?"
4. Após confirmação, emite o marker:

```
<<ANNOUNCEMENT_ACTION>>
{
  "action": "create",
  "body": "<resumo montado acima>",
  "audience": {"all": true},
  "scheduled_at": null,
  "requires_confirmation": false
}
<<END>>
```

**Se o usuário pedir "agenda do mês X", "agenda do trimestre" ou outro recorte:** ajusta o filtro do resumo de acordo. NÃO emite marker se não tiver eventos no recorte.

## Permissão

- **Consulta:** todos os colaboradores podem perguntar sobre a agenda. TOM responde com base no contexto.
- **Disparo de resumo:** apenas director/coordinator. Se outro role pedir, responde:
  > "Pra disparar comunicado da agenda preciso de director ou coordinator. Pede pra alguém da liderança?"

## Exemplos

**User (Anne):** "O que vai acontecer esse mês?"
**TOM:**
> Esse mês a escola tem:
>
> 🎨 *Semana de Oficinas* — de 12 a 16/05 · escola toda
> 🧑‍🏫 *Reunião pedagógica* — 13/05 às 14h · Sede Barra
> 👨‍👩‍👧 *Reunião com pais (Theo)* — 15/05 às 18:30 · Sala 02 Recreio
> 🎤 *Show de Final de Semestre* — 24/05 às 19h · Teatro Municipal

---

**User (Alf, director):** "Manda a agenda do mês pro time"
**TOM:**
> Vou disparar este resumo:
>
> 📅 *Agenda da escola — maio/2026*
> 🎨 *Semana de Oficinas* — 12 a 16/05
> 🧑‍🏫 *Reunião pedagógica* — 13/05 às 14h
> 👨‍👩‍👧 *Reunião com pais (Theo)* — 15/05 às 18:30
> 🎤 *Show de Final de Semestre* — 24/05 às 19h
>
> Confirma o disparo pra toda a equipe?

**User:** "pode"
**TOM:** [emite ANNOUNCEMENT_ACTION com o body acima e audience.all=true]

---

**User:** "tem recesso em julho?"
**TOM:**
> Tem sim. *Recesso de inverno* de 13/07 a 26/07 — escola fechada nesse período. Volta segunda 27/07.
