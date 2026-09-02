---
name: consultar-situacao-aluno-la
description: Consultar a situação operacional de alunos no LA Report pela RPC canônica get_situacao_alunos_v1/_resumo_v1 (compartilhada por TOM, Sol, Lia e app). Usar para "quem está sem anamnese / Instagram / foto / contrato", "quem não entrou na comunidade WhatsApp", "quem está inadimplente / em aviso prévio / próximo de renovar / vencendo contrato", "quantos faltam X", carteira por unidade, e qualquer pergunta sobre completude de cadastro ou pendências de aluno. Proíbe SELECT direto em alunos para essas perguntas.
---

# Consultar a situação do aluno — RPC canônica

## Regra de ouro

Agente **não escreve SQL** sobre `alunos`, `anamneses`, `movimentacoes_admin` ou
`emusys_faturas` para responder "situação do aluno". Chama a RPC e **cita a
`regra_versao` que ela devolve**. Se a RPC não responde a pergunta, veja
"O que ela NÃO responde" abaixo e use a fonte indicada — nunca improvise.

## As duas chamadas

```
postgrest POST /rpc/get_situacao_alunos_v1
  { "p_unidade_id": "<uuid>", "p_referencia": "2026-09-02", "p_apenas_pendentes": false }
→ lista, UMA LINHA POR PESSOA

postgrest POST /rpc/get_situacao_alunos_resumo_v1
  { "p_unidade_id": "<uuid>", "p_referencia": "2026-09-02" }
→ jsonb agregado: "quantos faltam X" sem puxar a lista
```

`p_referencia` default = hoje. `p_apenas_pendentes=true` → só quem tem
pendência de cadastro/anamnese/comunidade (a "fila de trabalho" do dia).

Unidades: Recreio `95553e96-971b-4590-a6eb-0201d013c14d` · Barra
`368d47f5-2d88-4475-bc14-ba084a9a348e` · Campo Grande
`2ec861f6-023f-4d7b-9927-3960ad8c2a92`.

## Como LER o resultado (as pegadinhas que já foram erro)

1. **Grão = pessoa, nunca matrícula.** `matriculas_ativas` é contagem de matrículas
   da pessoa (1 piano + 1 banda = 2), não outro aluno. `aluno_ids_locais` é a lista
   completa; `aluno_id_canonico` é a linha "principal".
2. **"Ativo" aqui = `entra_base_ativa`** (matrícula acadêmica ativa; trancado e
   só-banda/só-coral fora). Se a pergunta for "quantos ativos", o número de
   pessoas da RPC é o `alunos_ativos` do painel — bateram 336 no Recreio.
   Existirão outras definições (carteira professor, denominador de presença) —
   não misture.
3. **Cadastro agrega TODAS as matrículas vivas da pessoa.** Se o contrato existe
   no 2º curso, `tem_data_contrato=true`. Não "corrija" isso — é decisão de 02/09/2026.
4. **A régua de completude é configurável** (`config_cadastro_obrigatorio`, por
   unidade × LAMK/EMLA). Respondendo "cadastro completo?", leia `cadastro_completo`
   e `cadastro_faltando` — não reimponha uma lista fixa sua.
5. **Anamnese: devolve o PAR de propósito.** `anamnese_preenchida` (flag, mão
   única — só liga, nunca desliga) e `anamnese_em` (registro real hoje). Se
   `anamnese_flag_sem_registro=true`, a flag ficou ligada de algo apagado — diga
   isso, não afirme "anamnese preenchida". `anamnese_orfa_candidata_id` =
   formulário respondido não vinculado que casa por telefone/nome — o
   administrativo resolve com `vincular_anamnese_aluno`. Nunca devolva conteúdo
   médico/familiar da anamnese; esta RPC só expõe o booleano.
6. **Comunidade WhatsApp honra o "não sei".** `na_comunidade_wa=null` +
   `comunidade_status` ∈ `sem_grupo_configurado | sem_captura | captura_desatualizada`
   → **diga que não sabe**, jamais "está fora do grupo". Só declare
   "fora da comunidade" quando `comunidade_status='fora_da_comunidade'` (captura
   < 2 dias). A captura cobre os subgrupos onde uma caixa nossa é membro —
   em 02/09/2026, Campo Grande estava fora do ar por isso.
7. **Presença é propagada, não recalculada.** Veio de
   `get_frequencia_aluno_canonica_v1` com `presenca_confianca` e
   `presenca_regra_versao`. Confiança baixa → seja conservador no texto e cite a
   confiança. `dias_desde_ultima_aula` conta aula realizada (não cancelada) ≤
   referência — é recência de grade, não presença confirmada.
8. **`inadimplente`** = tem fatura de mensalidade vencida em aberto
   (`faturas_vencidas_abertas > 0`, fonte `vw_renovacao_ciclos`/`emusys_faturas`).
   Para detalhe (valor, multa, fila D+2): `sol_inadimplencia_v1` /
   `sol_faturas_alunos_v1` — a situação é só a bandeira.
9. **Ciclo contratual:** `proxima_renovacao_em` = vencimento da última parcela do
   contrato ainda não renovado. `em_aviso_previo` cobre mês vigente + seguinte.
   `contrato_vencido` = ciclo acadêmico encerrado sem sucessão.

## Bloco `base` do resumo — números DELEGADOS

`base` (`alunos_ativos`, `alunos_pagantes`, bolsistas, trancados, banda...) vem
inteiro de `get_kpis_alunos_admin_operacional` — a mesma fonte do relatório diário
das 20h. Se divergir de outra contagem, o problema está na outra contagem.
"Quantos alunos em banda" sai em **matrículas** (`matriculas_banda`) — quem faz só
banda não é pessoa da base.

## O que ela NÃO responde (fonte certa)

| pergunta | fonte |
|---|---|
| Faturas detalhadas, valores, fila de cobrança | `sol_faturas_alunos_v1` |
| Inadimplência com valor atualizado/multa | `sol_inadimplencia_v1` |
| Evasões/renovações do mês, churn | `mapa-de-fontes.md` §1.2 (`movimentacoes_admin_vigentes`) |
| KPIs mensais/fechamento/snapshot | `get_kpis_alunos_canonicos` |
| Risco de evasão (modelo) | fora da v1 de propósito; `vw_risco_evasao_atual` com o `calculado_em` escancarado |
| Achar aluno por nome | `buscar_alunos_ativos_atuais_canonicos` / `maria_lareport_buscar_alunos` |

Regras de negócio de KPI (pagante, churn, ticket, aviso prévio) vivem em
`.claude/skills/sol-la-report-business-rules/references/mapa-de-fontes.md` —
este skill é o contrato DA RPC; aquele é o mapa das métricas.

## Anti-padrões (proibidos)

- `COUNT(*) FROM alunos WHERE status='ativo'` — conta matrícula, infla.
- Dizer "fora da comunidade" com captura velha ou ausente.
- Tratar `anamnese_preenchida=true` como prova de que existe formulário hoje.
- Recalcular presença em SQL próprio em vez de propagar os campos canônicos.
- Montar lista de pendências fora de `pendencias`/`cadastro_faltando` (a régua
  pode mudar por unidade sem mexer em código).
- Devolver dado de outra unidade: a RPC exige permissão `alunos.ver` na unidade
  (ou service_role) — chamada negada (`42501`) deve ser REPORTADA, nunca contornada.
