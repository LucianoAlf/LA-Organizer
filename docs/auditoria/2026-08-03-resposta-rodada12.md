# Resposta à auditoria cruzada — rodada 12 (Fatia 1.8, só runner)

**Commit: `477a8697`** · **Estado:** migration **não aplicada** em `public`.

```
git fetch && git checkout 477a8697
bash scripts/test-router-ownership.sh            # EXIT=0
MUTATE=1 bash scripts/test-router-ownership.sh   # EXIT=0 = detectou o bug
```

---

## Veredito

**Procede.** Era a única chamada que ainda escapava da regra que eu mesmo escrevi na rodada anterior — e escapava justamente na suíte principal, a que mais decide.

Você nomeou certo: *"verde baseado em interpretação de saída, não em sucesso verificável"*. O `grep '^psql:.*ERROR:'` dependia do formato da mensagem, do idioma e da versão do `psql`. Um `psql` em outra locale, uma mudança de prefixo, e o contador daria zero com a suíte quebrada.

## O que mudou

- A suíte roda com **`ON_ERROR_STOP=1`**, **stderr em arquivo próprio** e **exit code conferido e reportado** (`OK suíte SQL executou até o fim (exit 0)`). O `_res` continua, mas para asserção **lógica** — não mais para saber se a suíte chegou ao fim.
- **Piso de cobertura (181).** Com `ON_ERROR_STOP` a suíte aborta em erro e o `rc` pega; mas um bloco comentado por engano cairia calado. O total nunca deve diminuir.
- **O `trap` acusa.** Se o schema não sair, imprime o resíduo e **força `exit 1`**. Resíduo silencioso no banco de produção é exatamente o que a promessa "descartável" não pode quebrar — e até agora ele apenas tentava, sem verificar.

**Declarando o que sobrou:** restam 3 `psql` sem `ON_ERROR_STOP`, todos leitura de verificação com fallback explícito (`|| left="?"`, `|| LEFT="erro"`). Qualquer valor diferente de `0` já reprova no `assert_eq`, então o erro não vira verde. Se você preferir uniformidade total, mudo — mas não quis criar exceção implícita sem dizer.

---

## Prova

```
  OK   suíte SQL executou até o fim (exit 0)
  OK   asserções falhas = 0
  OK   asserções executadas = 181 (piso 181)
  ... corrida de 8 · R8 · C1..C4 ...
  OK   schema restante = 0
=== TODAS AS CHECAGENS PASSARAM ===        EXIT=0
(duas execuções consecutivas, EXIT=0 nas duas)
```

**Mutante:**
```
FALHOU: C2 ... obtido 'true/ok'   ·  C2 TTL revivido: 'true'
FALHOU: C3 ... obtido 'NULO'
FALHOU: C4 ... obtido 'true/ok'   ·  C4 status do passo: 'done'
=== MUTANTE: os testes DETECTARAM o bug ===   EXIT=0
```

Suíte JS: 2100 pass / 3 fail (baseline). Router: 21/21.

---

## Balanço das quatro rodadas de falso-verde

| rodada | o instrumento dizia verde porque… |
|---|---|
| 4 | bloco `DO` abortava e o resumo somava só o que sobrou |
| 8 | `UPDATE` afetava zero linhas e a função devolvia `ok=true` |
| 11 | `ERROR` do `psql` virava texto e não casava com o padrão esperado |
| 12 | a suíte concluía "sem erro" por `grep` no formato da mensagem |

Quatro formas do mesmo problema: **medir por aparência em vez de por contrato.** É a mesma doença que o TOM tem quando diz "concluí" sem ter concluído — só que na minha camada. Não é coincidência que este projeto inteiro gire em torno disso.

---

## Estado

Migration **não aplicada** · router **não ligado** · canário **não aberto** · RPCs de negócio fora (E2.0) · `soul/` e `skills/` intocados · TOM v1 sem alteração nenhuma desde o início da fatia.

Segue aberto: as 5 funções `SECURITY DEFINER` já em produção executáveis por `anon`, incluindo `current_collab_id`.
