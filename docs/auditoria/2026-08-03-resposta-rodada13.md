# Resposta à auditoria cruzada — rodada 13 (Fatia 1.9, só runner)

**Commit: `06cbb156`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 06cbb156
bash scripts/test-router-ownership.sh            # EXIT=0
MUTATE=1 bash scripts/test-router-ownership.sh   # EXIT=0 = detectou a mutação CERTA
bash scripts/selftest-mutante.sh                 # EXIT=0 = o veredito do mutante REPROVA
```

---

## Veredito

**Procede.** E o lugar é irônico: o modo mutante existe justamente para provar que a prova
detecta o bug — e ele mesmo se autoaprovava com "alguma coisa falhou". Uma queda de rede no
meio da corrida de 8, um `drop` que não sai, um background que morre: qualquer um deles
setava `FAILED=1` e o mutante anunciava detecção sem que C2/C3/C4 tivessem chegado a rodar.

## O que mudou

**1. Toda falha carrega chave estável.** `fail <chave> <mensagem>`. Para asserção, a chave é
o **próprio label impresso** — sem indireção. Se alguém renomear o label, o mutante reprova
por "não detectou" e obriga a atualizar conscientemente, em vez de silenciar.

**2. Contrato nomeado.** `MUT_ESPERADAS` lista as 5 asserções sensíveis ao relógio. No
mutante, `EXIT=0` exige **todas as 5 falhando** e **nenhuma falha fora da lista**:

| chave | o que a mutação faz com ela |
|---|---|
| `C2 touch com TTL cruzando a espera` | `false/expired` → `true/ok` |
| `C2 TTL revivido` | `false` → `true` |
| `C3 open com TTL vencido durante a espera` | `ABRIU` → `NULO` |
| `C4 step_finish com lease vencendo na espera` | `false/stale_lease` → `true/ok` |
| `C4 status do passo` | `in_progress` → `done` |

C1 fica fora da lista de propósito: discrimina **posse**, não relógio, e passa nos dois modos
— declarado desde a rodada 10.

**3. O veredito foi visto reprovando.** Um veredito que nunca reprovou é só mais uma
promessa não verificada — que é exatamente a doença destas quatro rodadas.
`scripts/selftest-mutante.sh` sabota o runner e exige reprovação nos dois eixos:

- **(A) falha fora da lista** — injeta `fail "sabotagem-de-ambiente"` → tem de acusar
  `FALHA INESPERADA`;
- **(B) mutação placebo** — aplica a migration **sem** trocar o relógio → tem de acusar
  `NÃO DETECTOU`.

Cada variante confere antes que a sabotagem **realmente alterou** o runner (`cmp`). Sabotagem
que não sabota produziria um "reprovou" sem valor — o mesmo falso-verde uma camada acima.

---

## Prova

**Normal:**
```
  OK   suíte SQL executou até o fim (exit 0)
  OK   asserções falhas = 0 · asserções executadas = 181 (piso 181)
  OK   C1..C4, corrida de 8, R8 · schema restante = 0
=== TODAS AS CHECAGENS PASSARAM ===        EXIT=0   (duas execuções)
```

**Mutante:**
```
  FALHOU[C2 touch com TTL cruzando a espera]: esperado 'false/expired', obtido 'true/ok'
  FALHOU[C2 TTL revivido]: esperado 'false', obtido 'true'
  FALHOU[C3 open com TTL vencido durante a espera]: esperado 'ABRIU', obtido 'NULO'
  FALHOU[C4 step_finish com lease vencendo na espera]: esperado 'false/stale_lease', obtido 'true/ok'
  FALHOU[C4 status do passo]: esperado 'in_progress', obtido 'done'
  sensíveis ao relógio detectadas: 5/5 · falhas inesperadas: 0
=== MUTANTE: os testes DETECTARAM exatamente a mutação do relógio ===   EXIT=0   (duas execuções)
```

**Autoteste do veredito:**
```
  OK   [sabotagem] reprovou com exit 1 — FALHA INESPERADA: sabotagem-de-ambiente
  OK   [placebo]   reprovou com exit 1 — NÃO DETECTOU: C2 touch com TTL cruzando a espera
=== o veredito do mutante REPROVA nos dois casos ===   EXIT=0
```

Suíte JS: 2100 pass / 3 fail (baseline — `SUPABASE_URL` ausente). Router: 21/21.

**`public` intocado:**
```
tabelas_router_em_public=0 · funcoes_router_em_public=0 · schemas_de_teste=0
```

---

## Onde isso deixa a régua

Cinco rodadas de falso-verde, sempre o mesmo eixo — **medir por aparência em vez de por contrato**:

| rodada | o instrumento dizia verde porque… |
|---|---|
| 4 | bloco `DO` abortava e o resumo somava só o que sobrou |
| 8 | `UPDATE` afetava zero linhas e a função devolvia `ok=true` |
| 11 | `ERROR` do `psql` virava texto e não casava com o padrão |
| 12 | a suíte concluía "sem erro" por `grep` no formato da mensagem |
| 13 | o mutante aceitava "alguma coisa falhou" como prova de detecção |

A régua que sobrou das cinco: **nenhuma checagem entra sem ter sido vista reprovando.** É o
que o autoteste passa a garantir para o único juiz que ainda não tinha sido testado.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio
fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`,
incluindo `current_collab_id`.
