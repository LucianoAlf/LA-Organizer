# Pauta de migração para o PIX automático — design (16/09/2026)

## Problema

A LA Music ainda recebe mensalidade por Pix solto, cheque, boleto, dinheiro e cartão na
maquininha. O Pix solto é o pior: o cliente transfere quando lembra, atrasa, perde o desconto
de pontualidade, e a escola cobra juros e multa — briga garantida, para uma escola do tamanho
da LA. A saída é o PIX automático do Emusys (a LA é a primeira escola do Brasil a usar),
rodando há ~4 meses com poucos clientes.

Hoje a migração não tem lista, não tem dono e não tem placar. Três números que a auditoria
cruzada (LA Report × Super Folha, 15–16/09) mediu e que explicam a urgência:

- **340 clientes pagantes** precisam migrar (CG 226, Recreio 76, Barra 38).
- **22 famílias já estão cadastradas no PIX automático e não estão sendo cobradas por ele** —
  alguém cadastrou, ninguém autorizou. É dinheiro parado com trabalho já feito.
- **221 clientes pagam Pix solto**, 162 deles em Campo Grande.

**Meta para o time: zerar até 31/10/2026.** (A gordura de novembro fica com o Alf, não entra
na comunicação.)

## Fonte da verdade

`get_pix_migracao_v1(p_unidade_id, p_fatia)` no LA Report (`ouqwbbermlzqqvtqwlul`), lida pelo
TOM com a service_role. Uma linha por **cliente pagante** (responsável; se não houver, o
próprio aluno adulto). Devolve só nomes — nada de telefone, CPF ou e-mail, porque isso vai
para grupo de WhatsApp.

Como a fonte classifica (auditado no banco em 16/09):

| Categoria | Significado |
|---|---|
| `migrar` | precisa entrar no PIX automático; vem com `fatia` |
| `autorizacao_pendente` | PIX automático cadastrado, mas a cobrança não acontece |
| `ja_migrou` | cadastrado **e** a última mensalidade foi cobrada pelo sistema |
| `nao_mexe` | crédito recorrente pagando certinho |
| `inadimplente` | sem pagar há 90 dias — é cobrança, não migração |
| `nao_pagante` / `excecao` | bolsa integral, mensalidade zero, empresa/convênio |

O sinal que separa cobrança do sistema de baixa manual é a **tarifa**: Pix com tarifa (~R$ 1,99)
é o automático cobrando; Pix sem tarifa é alguém dando baixa na mão. Cartão sem bandeira com
tarifa (~R$ 4,46) é recorrente; com bandeira ou tarifa zero é maquininha.

O snapshot da RPC é atualizado de hora em hora, mas ele lê o **espelho diário** das faturas e
matrículas do Emusys. Logo, o dado tem até 24h de atraso — e o desenho abaixo conta com isso.

## Prioridade e fatias

A pauta é fatiada e a ordem importa. Nada fica escondido: a fatia do dia sai por extenso, as
demais aparecem contadas, porque é olhando a lista inteira que a equipe enxerga a oportunidade
(o boleto que atrasa todo mês, por exemplo).

1. 🔵 **Autorização pendente** (22) — cadastro feito, cobrança não acontece. Mata-se primeiro.
2. 🔴 **Pix avulso** (221) — a dor principal.
3. 🟠 **Cheque** (25) · 🟡 **Boleto** (8) · 🟡 **Dinheiro** (4)
4. 🟣 **Cartão falhando** (54) — cadastrado no cartão, mas algum mês caiu fora do recorrente —
   e **maquininha** (9), que é o cartão passado no balcão, sem recorrência nenhuma.
5. ⚪ **Sem histórico** (20) — matrícula nova, sem forma definida.

Os números acima são a foto de 16/09 e servem de referência; quem manda é a fonte no dia.

Todas ligadas desde o começo. A prioridade é comunicada pela ordem, pelo destaque e por quem
entra no lote do dia — não por esconder o resto.

## Como o cliente sai da lista

Pela fonte, como na anamnese. Ninguém dá check em lugar nenhum.

1. A equipe cadastra o PIX automático no Emusys.
2. No dia seguinte (espelho), o cliente **sai da fila de migração** e entra em
   "cadastrado, aguardando 1ª cobrança".
3. Quando a primeira mensalidade é cobrada pelo sistema (Pix com tarifa), ele vira
   **migrado** e sai de tudo. A tarefa do painel fecha sozinha.
4. Se voltar a pagar Pix na mão depois de cadastrado, **reaparece** em autorização pendente.

**Atalho opcional, para não esperar o espelho:** a pessoa responde ao TOM "cadastrei o
Fulano no automático". O TOM marca `cadastro_informado` na tarefa, tira o cliente do lote do
dia e **diz que vai conferir na fonte**. Se em 7 dias a fonte não mostrar o cadastro, a tarefa
volta com a linha honesta ("você me disse que cadastrou, mas não achei no Emusys"). O atalho
adianta a baixa; ele nunca substitui a prova.

## Pauta nos grupos das unidades

Entra junto com anamnese e contrato, no mesmo pacote e na cadência que **cada unidade já tem**
(Recreio: resumo no início do dia e de hora em hora; Barra: só no início do dia; Campo Grande:
início da tarde). O PIX não cria horário novo nem mensagem separada.

Lote diário por unidade: **10 clientes**, puxados na ordem de prioridade acima. Só entra lote
novo quando o do dia é resolvido ou vence — o mesmo desenho da anamnese e do contrato.

Forma da mensagem (uma seção por fatia, hierárquica, com o lote do dia por extenso):

```
💠 *PIX automático — Campo Grande* · faltam 232 · meta 31/10
🔵 *Cadastrados sem cobrança* (6) — resolver primeiro
   • Fulana de Tal (Ana, Pedro)
   • ...
🔴 *Pix avulso* (162)
   • Beltrano da Silva (João)
   • ...
🟠 Cheque (15) · 🟡 Boleto (8) · 🟡 Dinheiro (1) · 🟣 Cartão falhando (14) · ⚪ Sem histórico (18)
```

## Relatório semanal — grupo PIX AUTOMÁTICO L.A

Segunda, 10h. Desempenho, sem lista de nomes:

```
💠 *PIX automático — semana de 13 a 19/10*
Geral  ▓▓▓▓▓▓░░░░ 58%  (198 de 340)  · meta 31/10
Campo Grande ▓▓▓▓░░░░░░ 41% (93/226) — 12 nesta semana
Recreio      ▓▓▓▓▓▓▓▓░░ 76% (58/76)  — 9 nesta semana
Barra        ▓▓▓▓▓▓▓░░░ 71% (27/38)  — 4 nesta semana
🔵 Cadastrados sem cobrança: 9 (era 22)
Ritmo: faltam 2 semanas e 142 clientes → 71 por semana.
```

O ritmo necessário é calculado, não chutado. Se o ritmo da semana ficar abaixo do necessário
por duas semanas seguidas, a mensagem diz isso em uma linha.

## Guardas

- **Sem fonte, não cobra.** Se a RPC falhar ou o dado estiver com mais de 48h, o TOM não
  publica número nenhum e diz que a fonte não respondeu. (Mesma regra da pauta de anamnese.)
- **Idempotência por (unidade, dia)** no padrão GROUP_MEMORY, com marcador próprio. O cron bate
  o slot mais de uma vez.
- **Teto de sanidade:** no máximo 15 tarefas-filhas por unidade por dia. Acima disso, não cria
  e registra o motivo.
- **Privacidade:** só nome do pagador e dos alunos. Nada de telefone, CPF, valor ou fatura no
  grupo.
- **Voz do TOM:** os textos são do sistema, não do LLM.

## Peças

| Peça | Responsabilidade |
|---|---|
| `src/services/pix-migracao.js` | PURO: ordenar por prioridade, montar o lote do dia, formatar as seções da mensagem e a barra do relatório |
| `src/rituals/pix-migracao.js` | ler a RPC, montar/fechar o pacote do dia por unidade, gravar marcador |
| `src/rituals/dispatcher.js` | chamar a pauta do PIX junto da anamnese/contrato e o relatório semanal na segunda 10h |
| `src/engine.js` | atalho "cadastrei o fulano no automático" → marca `cadastro_informado` e confere depois |

## Pré-requisito operacional

O grupo **PIX AUTOMÁTICO L.A** precisa estar cadastrado em `work_groups` com o `wa_group_jid`.
O TOM já está dentro do grupo; falta capturar o JID e vincular. Sem isso, o relatório semanal
não tem para onde ir — e o TOM deve dizer isso, não falhar calado.

## Como isso é testado

- Camada pura com teste antes do código (ordem das fatias, lote do dia, texto das seções,
  barra de progresso, cálculo do ritmo).
- Mutantes na camada pura.
- E2E pelo `processMessage` real no perfil QA, com WhatsApp interceptado: pauta publicada,
  atalho de baixa, reaparecimento de quem voltou ao Pix manual.
- Suíte inteira verde antes do commit (`grep -q "^# fail 0$"`).

## Fora de escopo

- Cadastrar o PIX automático no Emusys pelo TOM (a API não expõe isso; o cadastro é humano).
- Cobrança de inadimplente — é outra frente.
- Mexer em quem paga certinho no crédito recorrente.
