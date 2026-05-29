# Handoff → chat do TOM-Coach (Pilar 2)

**De:** chat da Fundação de Preferências por Contexto (silêncio/lembretes pessoal vs trabalho)
**Para:** chat que desenvolve a `skills/coach-usabilidade.md` (TOM Coach de Usabilidade, Pilar 2)
**Data:** 2026-05-29
**Ação esperada:** incorporar a **definição semântica de contexto** abaixo na sua skill, pra o coach não classificar item errado.

---

## O que estamos construindo do nosso lado (resumo)

Estamos separando as preferências de **silêncio e lembretes do TOM por contexto** — `pessoal` vs `trabalho` — espelhando a dualidade que já existe na Agenda (abas Pessoal/Trabalho) e no campo `context` de `tasks`/`events`.

Motivador (caso real — Gabi): ela pediu ao TOM *"me manda lembrete só após 14h"*. O TOM persistiu como silêncio **global** (`quiet_start=00:00`, `quiet_end=14:00`), o que mata **tudo** de manhã — inclusive lembretes que ela QUERIA (ex: academia). A intenção real dela era: *"silêncio das coisas de **LA Music** até eu pegar no trabalho às 14h — minha vida pessoal de manhã continua"*.

Nossa fundação vai adicionar janelas de silêncio separadas (`quiet_*_work` / `quiet_*_personal`) e fazer o dispatcher respeitar o contexto de cada mensagem proativa. **Cada tarefa/evento/lembrete já carrega um `context` (`work`|`personal`)** — é esse campo que decide qual janela de silêncio se aplica.

---

## ⚠️ A definição semântica que você PRECISA cravar (o ponto deste handoff)

No sistema LA Organizer, `context` é **binário** e tem um significado específico que NÃO é "vida pessoal vs vida profissional":

> **`work` (Trabalho) = atividades da pessoa DENTRO da LA Music** (organizacional).
>
> **`personal` (Pessoal) = TUDO que não é LA Music — INCLUSIVE trabalhos/profissão paralela da própria pessoa.**

### Exemplos que enganam (o risco)

| Mensagem do usuário | Classificação CORRETA | Por quê |
|---|---|---|
| "Tenho aula de bateria pra dar amanhã" (Jordan) | **personal** | É trabalho dele, mas NÃO é LA Music |
| "Vou ter o festival de fatias da Lúcia" | **personal** | Empreitada pessoal dela, fora da LA Music |
| "Preciso fechar a folha de pagamento da unidade" | **work** | LA Music organizacional |
| "Lembra de pagar minha conta de luz" | **personal** | Vida pessoal |
| "Reunião de coordenação do Recreio" | **work** | LA Music |

**O erro a evitar:** ouvir palavras como "aula", "trabalho", "festival", "reunião", "cliente" e jogar tudo pra `work`/LA Music. Profissão paralela e empreitadas próprias da pessoa são **`personal`**.

### Regra prática pro coach
Quando você (coach) ajudar a transformar algo em tarefa/evento/inventário (seus padrões P1–P4), e for **atribuir o `context`**:
1. Pergunte-se: *"isso acontece dentro da operação da LA Music?"* → Sim = `work`; Não = `personal`.
2. **Na dúvida, NÃO assuma `work`.** Pergunte ao usuário ("isso é coisa da LA Music ou pessoal seu?") ou deixe `personal` como default mais seguro (menos invasivo — entra nas janelas de silêncio pessoal, não nas cobranças de trabalho).
3. Isso vale especialmente pro seu **P2 (brain-dump → tarefas)** e **P1 (inventário)**: o `context` que você setar vai determinar se o TOM vai cobrar/lembrar daquilo nas janelas de trabalho ou pessoal da pessoa.

---

## Dependência entre os dois trabalhos

- **Nós (fundação):** entregamos o modelo de dados (`context`-aware quiet windows), a UI de Configurações com abas Pessoal/Trabalho, e o dispatcher respeitando contexto. Não mexemos na conversa do TOM.
- **Vocês (coach):** quando o coach cria/classifica itens, precisa setar o `context` certo seguindo a definição acima. Se classificar errado, o item cai na janela de silêncio errada (ex: aula de bateria do Jordan vira "trabalho LA Music" e ele para de ser lembrado de manhã porque silenciou trabalho).

Sem alinhar essa semântica, os dois sistemas brigam. Com ela alinhada, encaixam: o coach classifica certo → a fundação silencia/lembra no contexto certo.

---

## TL;DR pra colar na sua skill

> No LA Organizer, `work` = LA Music organizacional; `personal` = tudo fora da LA Music, **incluindo a profissão/empreitadas paralelas da pessoa** (aula de bateria, festival próprio). Ao classificar qualquer item, pergunte "isso é da operação LA Music?". Na dúvida, prefira `personal` ou pergunte — nunca assuma `work` por causa de palavras como "aula/trabalho/cliente".
