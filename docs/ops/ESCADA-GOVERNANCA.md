# Escada de evolução do agente de governança

O agente LÊ este arquivo no início de cada rodada e ESCREVE nele no fim, quando tiver
evidência. Subir de degrau é mudança no próprio agente — **precisa de OK do Alf ou do Hugo no
grupo**, não cabe na autonomia dele.

## Onde estamos

**Degrau 1** — o LLM executa todas as etapas, guiado pelo protocolo.

## Os degraus

| degrau | o que é | quando sobe |
|---|---|---|
| 1 | LLM executa tudo, guiado pelo protocolo | — |
| 2 | as etapas que provarem ser mecânicas viram código | uma etapa erra ≥3× no mesmo padrão |
| 3 | pipeline determinístico; LLM só onde exige julgamento | maioria das etapas no degrau 2 |

## Regra para propor subida

Não proponha melhoria genérica ("acho que devia ser mais determinístico"). Proponha a partir
do próprio erro medido, com o caso na mão:

> etapa X falhou N vezes, no padrão Y. Casos: [links/códigos]. Proposta: virar código assim.

## Registro de falhas por etapa

_(vazio — o agente preenche conforme errar)_
