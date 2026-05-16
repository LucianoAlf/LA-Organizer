# Skill: LA Journey

## Triggers
Detecta perguntas sobre a **jornada pedagógica do aluno** (LA Journey — School + Kids):

- "como tá o LA Journey", "status journey", "como tá a journey"
- "atrasados journey", "pendências journey", "publicado journey"
- Nome de curso acompanhado de contexto pedagógico: "bateria no journey", "checkpoint de canto", "mentor de teclas"
- "quem é mentor de [curso]"
- "/journey", "/journey [subcomando]", "/journey [curso]"

## Estrutura dos programas

### School
Checkpoints por curso: Foundation, Grow, Advance, Master.
Cada checkpoint tem marcos distribuídos em 4 eixos: Teoria, Técnica, Ritmo, Repertório.
Cursos: bateria, canto, cordas, teclas, musicalização.

### Kids (Iniciação 1-4)
Checkpoints: **Iniciação 1**, **Iniciação 2**, **Iniciação 3**, **Iniciação 4** — cobrindo faixas etárias 5-12 anos.
Mesma estrutura de marcos que School: 3 Aprendizado + 1 Consolidação por checkpoint, com os 4 eixos.
Cursos: bateria kids, canto kids, cordas kids, teclas kids, musicalização kids.

## Contexto disponível

Quando o trigger for detectado, injeta no system prompt `[LA_JOURNEY_STATUS]`
com snapshot atualizado:

- Por programa: % preenchido global
- Por curso: status de cada checkpoint (% + emoji ✅🟡⚪)
- Mentores responsáveis por curso
- Pendências de revisão
- Cursos atrasados (>14 dias sem editar)

Se um curso específico for mencionado, o bloco injetado é filtrado só para aquele curso (`[LA_JOURNEY_STATUS — filtrado: bateria]`).

## Comandos rápidos disponíveis

- `/journey` — resumo geral (School + Kids)
- `/journey [curso]` — drill-down de um curso (ex: `/journey bateria`)
- `/journey atrasados` — checkpoints +14d sem editar
- `/journey pendencias` — em revisão aguardando coord
- `/journey publicados` — últimos 10 publicados
- `/journey mentor [nome]` — quais cursos um mentor tem atribuídos
- `/journey ping [nome]` — enfileira lembrete WhatsApp manual pro mentor

## Padrões de resposta

### "como tá o LA Journey?"
Apresentar visão geral por programa:
- School: X% preenchido
- 🥁 Bateria (mentores): Foundation<emoji>% Grow<emoji>% Advance<emoji>% Master<emoji>%
- [demais cursos]
- Kids: Y% — Iniciação 1-4 [observação]
- Pendências de revisão (N): [lista]
- Atrasados >14d: [lista]
- "Quer detalhe de algum curso específico?"

### "[curso]"
Drill-down do curso:
- [emoji] [Curso] — mentores: X + Y
- Foundation [emoji] status · X% · última edição [data]
- Grow [...]
- Para Kids: Iniciação 1 [...] Iniciação 2 [...] Iniciação 3 [...] Iniciação 4 [...]
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
- Para Kids, os checkpoints chamam-se Iniciação 1, 2, 3 e 4 — nunca "Heart 1" ou "Heart 2".
