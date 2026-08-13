# 📊 Reportes operacionais da Maria — design

**Data:** 13/08/2026 · **Pediu:** Rose (via Alf) · **Pilota:** este chat · **Status:** desenho aprovado
em conversa, aguardando plano de implementação.

---

## 1. O pedido

Literal da Rose, 13/08:

> *"Da pra criar uma função pra Maria? Todo dia às 20h ela listar as saídas do dia pra lançar e
> esperar meu ok? e toda sexta ela verificar a semana, e no último dia do mês ela verificar o mês.
> Seria automático igual ela faz com contas do dia q ta dando super certo"*

**O que ela quer, esclarecido pelo Alf:** não é autorização de lançamento em lote. É **conferência de
fechamento** — a Maria mostra o que lançou durante o dia e o que ficou faltando, e no fim oferece
lançar o resto, exatamente como já faz hoje item a item.

**O contexto que só o Alf sabia, e que mudou o desenho:** o trabalho no grupo é conversado. A equipe
posta o comprovante, a Maria monta a proposta, **pergunta "tá certo? posso lançar?"**, as meninas
corrigem o que estiver errado (plano de contas, um detalhe) e só então ela lança. Ou seja, o item
percorre estágios — e o mais útil para a Rose é **saber em qual estágio a bola parou**.

---

## 2. O que já existe (auditado em 13/08, não presumido)

| peça | estado medido |
|---|---|
| `whatsapp_grupo_notificacoes` — fila de agendamento por grupo | **funcionando** |
| `whatsapp-grupo-dispatcher` + `pg_cron` a cada 5 min | **funcionando** |
| `contas_a_pagar_dia`, 08:00 | **ativo**, rodou 13/08 às 08:00:05 |
| `contas-pagar-dia-gerar` (Edge Function) | **é quem escreve o texto** do relatório das 08h — o bridge só entrega |
| `resumo_financeiro_semanal` (seg 08:00) | cadastrado 24/06, **inativo, nunca rodou** |
| `resumo_financeiro_mensal` (dia 1, 09:00) | idem — observação diz literalmente *"Gerador a criar"* |
| `maria_conferencias_lancamento` | tem `chat_id`, `criado_por_nome`, `aprovado_por_nome`, `aprovado_at`, `versao`, `parent_conferencia_id` |
| `maria_conferencia_lancamento_itens` | **307 itens, 136 nos últimos 7 dias**, com `status`, `plano_codigo`, `plano_origem`, `observacoes` |
| `maria_whatsapp_daily_snapshots` (snapshot do Alfredo) | 14 linhas de teste (11/08), código no bridge sob `SNAPSHOT_V31_*`, **flag ausente do env → desligado** |

**A descoberta central.** O relatório que "dá super certo" **não é escrito pelo modelo**: uma Edge
Function devolve a mensagem pronta e o bridge entrega. É por isso que ele sai sempre igual e correto.
**Este design replica esse padrão** — nenhum número deste relatório passa por LLM.

**A pilha invisível.** Estado atual dos itens de conferência:

| status | total | últimos 7 dias | com vínculo |
|---|---|---|---|
| `lancado` | 175 | 53 | 172 |
| `pendente` | **127** | **83** | 47 |
| `aprovado` | 5 | 0 | 0 (estado órfão) |

São 127 itens parados, 83 desta semana. **O relatório vai expor isso** — e é bom que exponha.

**O buraco que justifica a peça nova.** Em 13/08, no grupo Financeiro: **31 mensagens recebidas, 4
com comprovante, 0 itens de conferência criados.** Comprovante que chega **não vira registro
sozinho** — a conferência só nasce quando alguém pede. O que ninguém pediu, ninguém vê.

---

## 3. Decisões (não re-litigar)

| # | decisão | quem |
|---|---|---|
| D1 | O relatório **confere**, não autoriza escrita em lote. Termina oferecendo lançar o que falta. | Alf |
| D2 | Fonte do "faltando" = **comprovante que caiu no grupo e não virou lançamento**. As outras duas fontes possíveis (conta vencida no Super Folha; item que travou) ficam fora. | Alf |
| D3 | Os três reportes vão para o **Financeiro Grupo LA Music** (`120363231958653729@g.us`), com linguagem operacional. | Alf |
| D4 | **20h30** para os três (diário, sexta, último dia do mês). | Alf |
| D5 | Formato aprovado sem alteração — §6. | Alf |
| D6 | Registro **na entrada** ("caderno"), não reconstrução noturna. | Alf |
| D7 | Quarta seção 💬 **"esperando vocês"** entra. | Alf |
| D8 | Snapshot do Alfredo **fica desligado** neste escopo. | este chat |

**Sobre D2, com o risco escrito:** essa fonte tem uma falha conhecida — se a Maria não reconhecer um
comprovante, ele não entra na lista e **ninguém percebe a ausência**. O Alf conhece e aceitou. A
mitigação é a cobertura declarada (§7), que não elimina o risco, mas o torna **visível**.

---

## 4. Arquitetura

```
  mensagem chega no grupo
          │
          ▼
   ┌──────────────┐   registra na hora, sem LLM
   │ 1. CADERNO   │───────────────────────────────┐
   │  (bridge)    │                               │
   └──────────────┘                               ▼
                                        ┌──────────────────┐
   fluxo que já existe:                 │  3. GERADOR      │
   conferência → "posso lançar?" ──────►│  (Edge Function) │
   → correção → lançamento              │  monta o texto   │
          │                             └────────┬─────────┘
          ▼                                      │
   Super Folha (status)  ────────────────────────┘
                                                 │
                              ┌──────────────────▼─────────────┐
                              │ 2. FILA + DISPATCHER (existe)  │
                              │    20h30 → entrega no grupo    │
                              └────────────────────────────────┘
```

Três peças, uma responsabilidade cada: **o caderno diz o que passou**, **o Super Folha diz o que virou
lançamento**, **o gerador cruza e escreve**.

---

## 5. Modelo de dados

### 5.1 A tabela nova — o caderno

```sql
create table maria_grupo_movimento_dia (
  id                    uuid primary key default gen_random_uuid(),
  chat_id               text not null,
  message_id            text not null,
  data_referencia       date not null,          -- dia civil BRT, nunca UTC
  recebido_em           timestamptz not null,
  autor_nome            text,                   -- quem postou, como o grupo mostra
  tipo_detectado        text not null,          -- comprovante | boleto | pix | valor_em_texto | indefinido
  valor_centavos        integer,                -- null quando não deu para ler
  descricao_curta       text,
  -- vínculos: preenchidos quando o item avança
  conferencia_item_id   uuid,
  conta_pagar_id        uuid,
  fluxo_evento_id       uuid,
  status                text not null default 'detectado',
      -- detectado | em_conferencia | aguardando_validacao | lancado | descartado | ilegivel
  motivo_status         text,                   -- por que travou, em português
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now(),
  unique (chat_id, message_id)
);

create index on maria_grupo_movimento_dia (chat_id, data_referencia);
create index on maria_grupo_movimento_dia (status) where status <> 'lancado';
```

**Por que tabela própria e não reusar `maria_conferencia_lancamento_itens`:** o caderno recebe ~30
linhas por dia por grupo. Jogar isso na fila de conferências, que já tem 127 pendências reais,
enterra o trabalho de verdade sob ruído de captura. São perguntas diferentes: *"o que passou no
grupo"* × *"o que virou processo"*.

**`unique (chat_id, message_id)`** é a trava de idempotência: reprocessar a mesma mensagem não
duplica linha.

**Quem move cada estado — sempre código, nunca o modelo:**

| transição | quem dispara |
|---|---|
| → `detectado` | o bridge, na chegada da mensagem |
| → `aguardando_validacao` | o bridge, quando a Maria envia a pergunta de confirmação ("posso lançar?") |
| → `em_conferencia` | o bridge, quando o item entra numa conferência |
| → `lancado` | o mesmo mecanismo que hoje decide reagir com ✅ — ele já resolve item ↔ mensagem do grupo, e é reusado aqui em vez de reimplementado |
| → `ilegivel` | o bridge, quando a extração falha (OCR vazio, sem valor) |
| → `descartado` | quando alguém do grupo diz que não é para lançar; **exige menção explícita**, nunca inferência |

O estado `descartado` existe para que "não é despesa" não vire pendência eterna. Sem ele, um print
de conversa mandado no grupo apareceria em ⏳ para sempre.

### 5.2 Funções de controle (para a trava da §7)

```sql
-- devolve os números do período direto da fonte, para conferir o que o relatório afirma
create function maria_rel_ctl_periodo(p_chat_id text, p_inicio date, p_fim date)
returns table (mensagens int, lancados int, faltando int, aguardando int, ilegiveis int);
```

### 5.3 O que **não** muda

`maria_conferencias_lancamento` e `maria_conferencia_lancamento_itens` ficam como estão. O caderno
**aponta** para elas; não as substitui nem escreve nelas.

---

## 6. O gerador

**Nome:** `maria-relatorio-periodo` (Edge Function).
**Entrada:** `{ janela: 'dia' | 'semana' | 'mes', data_ref: 'YYYY-MM-DD', chat_id: string }`
**Saída:** `{ mensagem: string, contadores: {...}, ok: boolean, erro?: string }`

**Nenhum LLM participa.** Todo número sai de `count()`/`sum()` sobre caderno, conferência e Super
Folha.

### As quatro seções

| seção | como é decidida |
|---|---|
| ✅ **lancei** | linha do caderno com `status='lancado'` **e** vínculo não nulo |
| ⏳ **falta lançar** | `status='detectado'` — chegou e não virou nada |
| 💬 **esperando vocês** | `status='aguardando_validacao'` — a Maria perguntou "posso lançar?" e não houve resposta |
| ⚠️ **não consegui ler** | `status='ilegivel'`, com `motivo_status` |

### Formato aprovado (D5) — literal

```
📋 *Fechamento do dia — quarta, 13/08*

✅ *Lancei hoje — 7*
 • Buffet LA Culture · R$ 555,00 · _Barra_
 • FGTS 06/2026 · R$ 1.240,00 · _Recreio_
 • Manutenção de instrumentos · R$ 300,00 · _Barra_
 _+ 4 outros_

⏳ *Falta lançar — 3*
 • Comprovante da Ana · _Barra_ · 14h32
 • Boleto da Light · 16h05
 • Pix sem descrição · 18h20

💬 *Esperando vocês — 2*
 • Aluguel Recreio · R$ 4.500,00 · _perguntei o plano de contas às 11h20_
 • Uber equipe · R$ 87,40 · _confirmar unidade_

⚠️ *Não consegui ler — 2*
 • 11h04 · imagem ilegível
 • 15h47 · sem valor identificável

━━━━━━━━━━━━━━
💰 Total lançado: *R$ 4.320,00*
🔎 Conferi *31 mensagens* do grupo hoje

Quer que eu lance os 3 que faltam?
```

**Regras de formatação, fixas:**
- Máximo **3 itens por seção** + `_+ N outros_`. Em dia cheio a lista vira parede no celular.
- Negrito só no título da seção, no total e na contagem.
- Emoji **um por seção**, nunca dentro do item.
- Valor sempre `R$ 0.000,00`; unidade em itálico.
- Hora no formato `14h32`.
- A pergunta final só aparece **se houver o que oferecer**.

### Diferenças por janela

- **dia** — `data_ref`, título `Fechamento do dia — <dia da semana>, DD/MM`.
- **semana** — os **7 dias que terminam na sexta** do relatório (sábado anterior → sexta). Não é
  "segunda a sexta" de propósito: o relatório sai na sexta à noite, e movimento de sábado e domingo
  ficaria num vão entre uma semana e outra, sem nunca aparecer em relatório nenhum. Título
  `Fechamento da semana — DD/MM a DD/MM`; a seção ✅ vira agregada (*"lancei 34 no total"*) e as
  outras três permanecem item a item, porque é nelas que mora a ação.
- **mês** — mês civil de `data_ref`; mesmo tratamento da semana, mais uma linha de total do mês.

---

## 7. Travas

Todas vieram de erro real medido neste projeto:

1. **Cobertura declarada.** *"Conferi 31 mensagens"* é `count()` sobre o caderno, não estimativa. Se
   um dia sair "conferi 3", isso é o alarme de que a captura parou. **Sem esta linha, uma falha de
   captura vira um relatório limpo.**
2. **Nada some em silêncio.** Item que o sistema não classificou aparece em ⚠️, com motivo. Omitir
   seria transformar ignorância em conformidade.
3. **Falha é dita.** Se o gerador quebrar, a mensagem entregue diz que falhou e o que não pôde ser
   conferido. **Nunca** relatório vazio: vazio parece dia tranquilo.
4. **A soma bate com a lista.** `Total lançado` = soma dos itens contados na seção ✅. Divergência
   entre contagem e lista aborta a entrega — é o erro "1+9=11" que o agente do TOM cometeu em 10/08.
5. **Dia civil em BRT.** `data_referencia` calculada em `America/Sao_Paulo`. Um relatório gerado às
   20h30 com data em UTC cairia no dia seguinte.
6. **Idempotência.** Reexecução do mesmo período não duplica entrega — a fila registra
   `ultima_execucao`, e o gerador é função pura sobre o período.

---

## 8. Agendamento

Três linhas novas em `whatsapp_grupo_notificacoes`, todas para `120363231958653729@g.us`:

| tipo | frequência | horário | quando |
|---|---|---|---|
| `relatorio_operacional_dia` | diário | **20:30** | todo dia |
| `relatorio_operacional_semana` | semanal | **20:30** | sexta |
| `relatorio_operacional_mes` | mensal | **20:30** | último dia do mês |

**Problema real a resolver no plano:** a fila guarda `dia_mes` como número fixo, e "último dia" varia
entre 28 e 31. Convenção adotada: **`dia_mes = -1` significa último dia do mês**, e o dispatcher passa
a interpretar isso.

> ⚠️ **Risco:** o dispatcher é **compartilhado** — atende agenda, contas, folha e férias. A mudança
> tem de ser **aditiva** e acompanhada de teste que prove que os tipos existentes continuam
> disparando. Um erro aqui não quebra só o relatório novo: cala os que já funcionam.

---

## 9. Onde cada peça vive

| peça | onde |
|---|---|
| Caderno (captura) | `bridge.js` da Maria, no caminho de entrada da mensagem |
| Tabela + funções de controle | Super Folha `ubdvtjbitozhkuvvqkxj` |
| Gerador | Edge Function `maria-relatorio-periodo` |
| Agendamento | `whatsapp_grupo_notificacoes` + `whatsapp-grupo-dispatcher` |
| Testes | `tools/test_maria_caderno_grupo.js` (captura) e teste do gerador com fixtures |

---

## 10. Testes

**Captura (unitário, no bridge):**
- mensagem com imagem de comprovante → vira linha `detectado`
- mensagem de conversa comum ("bom dia") → **não** vira linha
- mesma mensagem processada duas vezes → **uma** linha (idempotência)
- imagem ilegível → linha `ilegivel` com motivo, **nunca** ausência de linha

**Gerador (com fixtures, sem banco vivo):**
- dia com as quatro seções povoadas → texto bate com o formato aprovado, caractere a caractere
- dia vazio → mensagem honesta de dia sem movimento, **com** a linha de cobertura
- total divergente da lista → **aborta** e reporta
- lista com 12 itens → mostra 3 + `_+ 9 outros_`
- fonte indisponível → mensagem de falha, nunca relatório limpo

**Agendamento:**
- os tipos que já existem continuam disparando depois da mudança do `dia_mes = -1`
- 31/01, 28/02 e 29/02 (bissexto) disparam o mensal; 30/01 não dispara

---

## 11. Fora de escopo

- **Relatório gerencial para a diretoria** (grupo `Maria Gestao Financeira`, `…408286610149`) — fase
  estratégica. **Dívida registrada:** esse grupo **não está** na allowlist do snapshot; quando a fase
  chegar, vai precisar entrar, não funciona de graça.
- **Snapshot do Alfredo** — fica desligado. Serve para memória e contexto do grupo, não para contar
  dinheiro.
- **Lançamento em lote por aprovação** — descartado em D1.
- **As outras duas fontes de "faltando"** — descartadas em D2.

---

## 12. Riscos conhecidos

| risco | mitigação |
|---|---|
| Comprovante não reconhecido some da lista (D2) | cobertura declarada torna a falha **visível**, não impossível |
| Mudança no dispatcher cala os relatórios que já funcionam | mudança aditiva + teste dos tipos existentes antes de publicar |
| A pilha de 127 pendentes aparece de uma vez e assusta | **é o objetivo** — mas avisar Rose e Ana antes de ligar (o Alf já vai fazer) |
| Captura no caminho de entrada pesa na latência | a gravação é uma linha, sem OCR extra: reusa o que o bridge já extrai |
| Relatório vira ruído se sair todo dia igual | rever em 30 dias: se a Rose parar de responder, o formato está errado |
