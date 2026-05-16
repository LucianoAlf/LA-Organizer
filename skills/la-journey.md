# Skill: LA Journey

## Triggers
Detecta perguntas sobre a **jornada pedagógica do aluno** (LA Journey — School + Kids):

- "como tá o LA Journey", "status journey", "como tá a journey"
- "atrasados journey", "pendências journey", "publicado journey"
- Nome de curso isolado: "bateria", "canto", "cordas", "teclas", "musicalização"
- "quem é mentor de [curso]"
- "/journey", "/journey [curso]"

## Contexto disponível

Quando o trigger for detectado, injeta no system prompt `[LA_JOURNEY_STATUS]`
com snapshot atualizado:

- Por programa: % preenchido global
- Por curso: status de cada checkpoint (% + emoji ✅🟡⚪)
- Mentores responsáveis por curso
- Pendências de revisão
- Cursos atrasados (>14 dias sem editar)

## Padrões de resposta

### "como tá o LA Journey?"
Apresentar visão geral por programa:
- School: X% preenchido
- 🥁 Bateria (mentores): F<emoji>% G<emoji>% A<emoji>% M<emoji>%
- [demais cursos]
- Kids: Y% — [observação]
- Pendências de revisão (N): [lista]
- Atrasados >14d: [lista]
- "Quer detalhe de algum curso específico?"

### "[curso]"
Drill-down do curso:
- [emoji] [Curso] — mentores: X + Y
- Foundation [emoji] status · X% · última edição [data]
- Grow [...]
- [etc]
- [Pergunta de seguimento]

### "atrasados journey"
Cursos parados há >14 dias:
- [curso] (X dias) — mentor: [nome]
- [...]

### "publicado journey"
Checkpoints publicados:
- [curso] [checkpoint] — em [data] por [coord]
- [...]

## Comportamento

- **Sempre** usar dados do `[LA_JOURNEY_STATUS]` injetado. Nunca inventar números.
- **Não comparar** com período anterior (não temos histórico de snapshots).
- Emojis de status: ✅ publicado, 🟡 em revisão, ⚪ rascunho, ⬜ sem início.
- Sugerir ação seguinte sempre que possível ("Quer revisar?" / "Quer ping pro mentor?").
- Se o usuário não tem permissão (não é coord/director nem mentor do curso), responder educadamente sem expor dados.
