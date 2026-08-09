# Agente de governança autônoma — design

**Data:** 08/08/2026 · **Decidido com:** Alf (dono do produto), com Hugo no canal
**Estado:** aprovado para virar plano de implementação

---

## O problema

`auditConversation` roda todo dia junto do Dream (03h), grava em `tom_audit_findings` e para
ali. Foi assim que **209 achados** ficaram meses sem ninguém olhar. O digest diário das 07:30
(no ar desde 08/08) resolveu a parte de *mostrar*. Falta a parte de *agir*: hoje quem trata
achado sou eu, à mão, um por vez.

## O que este agente é — e o que ele não é

| | canal de ops (**já no ar**) | agente de governança (**este spec**) |
|---|---|---|
| gatilho | vocês pedem no grupo | roda sozinho, todo dia |
| o que faz | responde, investiga, relata | **refuta, corrige, testa, sobe** |
| papel | porta-voz | motor |

O TOM do grupo continua sendo a **boca**; este agente é o que trabalha atrás dela.

## Decisões do Alf (08/08)

1. **Autonomia total, com prova obrigatória.** Sobe sozinho, sem pedir OK. Mas só corrige o
   que conseguiu **reproduzir**: teste vermelho antes, verde depois. Não reproduziu → não
   mexe, reporta e para.
2. **Raio: só `src/`.** `soul/` e `skills/` são intocáveis (voz do TOM). PWA, migrations e
   apagar dado de produção estão fora — nesses ele reporta e vocês decidem.
3. **Cadência: diário, logo depois do digest das 07:30.**
4. **Arquitetura: reusar a infra do canal de ops** com briefing próprio.
5. **Ele mede a própria eficácia e propõe a própria evolução.**

### Por que a prova obrigatória é a decisão central

Em 08/08 persegui quatro alvos vindos de findings. **Nos quatro, o conserto já existia no
código** — em três, o comentário citava o caso pelo nome. Um agente autônomo sem essa trava
teria feito quatro mudanças desnecessárias no `engine.js` em produção.

No mesmo dia, três contagens que sustentavam decisões morreram ao abrir o literal: 242
`schema_invalid` → 4; 6 erros de data → 1; 18 `ACTIONABLE_NO_MARKER` → 5. **Número de
marcador é hipótese.** Um agente que age sobre contagem age sobre fantasma.

---

## Arquitetura

Reusa o que já está em produção e provado: spawn do CLI `claude` com ferramentas, `cwd` no
repositório, sanitizador markdown→WhatsApp, split em mensagens, typing sustentado e drain
hook de restart.

```
dispatcher (08:00 BRT, após o digest das 07:30)
  └─ governance-agent.js
       ├─ monta o pedido do ciclo
       └─ ops-agent.runOpsAgent(pedido, { briefing: PROTOCOLO, timeoutMs: 30min })
            └─ CLI claude (Opus 5) com Bash/Read/Write/Edit/Grep/Glob, cwd=/opt/LA-Organizer
       └─ postOpsResult(...) → grupo LA ORGANIZER - TOM
```

**Arquivos:**

- `src/services/governance-agent.js` — orquestra o ciclo, idempotência, entrega.
- `docs/ops/PROTOCOLO-GOVERNANCA.md` — o protocolo (ordem obrigatória). **Editável sem
  deploy**, mesmo padrão do `FORMATO-GRUPO.md`.
- `docs/ops/ESCADA-GOVERNANCA.md` — os degraus de evolução. O agente **lê no início e
  escreve no fim** de cada rodada.
- `docs/ops/PEDIDOS-DE-PRODUTO.md` — fila do que é feature, não bug (etapa 2.5). Zero
  migration, versionado, e torna visível a demanda que hoje some dentro do finding.
- `src/services/ops-agent.js` — ganha dois parâmetros opcionais: `briefing` e `timeoutMs`.
  Sem eles, comportamento idêntico ao de hoje.

**Por que não um agente do zero:** reescreveria spawn, sanitização, posting e shutdown que
foram provados em produção hoje. O que distingue governança de ops é o *protocolo*, não a
plumbing.

---

## O protocolo (a ordem é obrigatória)

### Etapa 1 — Placar. Antes de qualquer achado novo.

> *Dos KIs que **eu** fechei, quantos voltaram?*

Consulta `tom_known_issues` com marca de autoria do agente e cruza com
`tom_audit_findings.auto_triage.decision = 'regression'`.

**A marca de autoria, concreta:** `fix_resumo` começa com o literal `[gov-agent]`. Escolhido
por não exigir migration — a tabela já tem o campo e ele é livre. O placar filtra por
`fix_resumo LIKE '[gov-agent]%'`, então mede só o que **ele** fez, sem contar os meus fixes
nem os do Hugo. Sem essa marca a etapa 1 não tem como existir: ele mediria o trabalho dos
outros como se fosse dele.

- **Mesmo KI reincidiu 2×** → a família entra em **parada**: o agente não corrige mais nada
  dela e leva ao grupo *"consertei isso duas vezes e voltou — não é fix pontual, a raiz é
  outra. Proposta: X"*.
- Isso é a etapa 1 de propósito: **não é lembrete, é pré-requisito**. Sem o placar, não há
  etapa 2.

### Etapa 2 — Escolher UM achado

Da janela do digest, com prioridade: regressão > severidade alta > o que tem literal claro.
**Um por rodada.** Ninguém revisa cinco mudanças de engine por dia.

### Etapa 2.5 — Natureza: isto é bug ou é pedido de coisa nova?

**Levantado pelo Alf em 08/08, olhando os logs da Rose.** Os findings misturam três naturezas,
e tratar as três como bug é o caminho mais curto pro agente violar o feature freeze
implementando funcionalidade sozinho.

**O critério é verificável, não julgamento:** *existe handler/marker no código para essa
capacidade?*

| natureza | teste | destino |
|---|---|---|
| **Bug** | a capacidade existe no código | segue o protocolo, corrige |
| **Feature** | não existe handler/marker | **não implementa** — registra e avisa |
| **Limitação de arquitetura** | existe, mas o conserto muda o desenho | **não implementa** — registra como tal |

Casos reais que definiram a regra:

- **Bug** — 16/07, TOM: *"não consigo executar o lançamento por aqui"*; Rose: *"você já lançou
  pra mim várias vezes"*. A capacidade existe → é bug. (É a assinatura de
  `project_tom_nega_capacidade`, usada aqui na direção normal.)
- **Feature** — 31/07: *"mas tá td misturado trabalho e pessoal aí né, organiza melhor pf"*.
  Não existe handler de separação trabalho/pessoal na apresentação → não é bug.
- **Feature** — 16/07: *"já que vc n pode apagar por aqui"* (estorno em lote; é a Fase B
  pendente do roadmap financeiro).
- **Limitação de arquitetura** — 25/07, TOM: *"não tenho os outros 7 lançamentos no meu
  contexto atual — o extrato veio de uma injeção que não persiste entre mensagens"*. **O mais
  perigoso**: soa como bug técnico, mas consertar é mudar o desenho.

**Destino de feature e limitação:** linha em `docs/ops/PEDIDOS-DE-PRODUTO.md` com data, pessoa,
o **literal** do pedido e quantas vezes já apareceu; aviso no grupo. O finding é fechado como
"não é bug".

Isso fecha uma segunda lacuna de graça: hoje esse pedido morre dentro do finding e **ninguém
vê a demanda acumulada** — só se descobre que a mesma pessoa pediu três vezes quando ela
reclama.

### Etapa 3 — Refutar antes de acreditar

Nesta ordem, e nenhuma pode ser pulada:

1. **`grep` o caso no `src/`**: nome da pessoa, data do incidente, código do marker. Em três
   dos quatro casos de 08/08 o comentário já nomeava o caso — o fix estava lá.
2. **Puxar o literal** de `conversation_history`. O resumo do finding **não** é a fala.
3. **Datar**: o fix existente é anterior ou posterior ao incidente?
4. **Rodar o caso contra o código atual.**

Se em qualquer ponto ficar claro que já está corrigido → **fecha o finding com o veredito e
encerra a rodada**. Refutar é entrega, não fracasso.

### Etapa 4 — Prova de reversão

Teste que **falha** contra o código atual, reproduzindo o caso real.

⚠️ **Reproduza com a entrada real do turno, não com o pedido original da conversa.** Em 08/08
isso custou 8 tentativas em branco: eu alimentava o áudio completo do usuário e o modelo
acertava 4/4; a entrada real daquele turno era só *"O q?"*, e aí errava 2/4.

**Não conseguiu o teste vermelho → não corrige.** Reporta o que tentou e para.

### Etapa 5 — Corrigir

Menor mudança que faz o teste passar. Suíte inteira tem que terminar no baseline
(`node --test "src/**/*.test.js"` → `fail 3`, que são de env ausente). Qualquer teste a mais
quebrado = reverte tudo e reporta.

### Etapa 6 — Registrar

KI em `tom_known_issues` com causa-raiz, prova de reversão (números antes/depois) e a **marca
de autoria do agente**. O finding é fechado apontando pro KI.

### Etapa 7 — Reportar e só então subir

Posta o resultado no grupo **antes** de reiniciar.

⚠️ **O agente roda como processo filho do TOM: se ele reiniciar o TOM, mata a si mesmo e o
relatório nunca chega** — foi exatamente assim que um pedido do Alf sumiu em silêncio em
08/08 19:29. Por isso: reporta primeiro, e o restart vai **desacoplado** — disparado de forma
que sobreviva à morte do processo que o pediu (`nohup`/`setsid`), nunca por chamada direta
dentro do turno.

### Etapa 8 — Atualizar a escada

Se alguma etapa falhou de forma repetida, registra em `ESCADA-GOVERNANCA.md` com o caso na
mão e a proposta concreta de virar código.

---

## A escada (auto-aperfeiçoamento)

| degrau | o que é | quando sobe |
|---|---|---|
| **1 — início** | LLM executa todas as etapas, guiado pelo protocolo | — |
| **2** | as etapas que provarem ser mecânicas viram código | quando uma etapa erra ≥3× no mesmo padrão |
| **3 — alvo** | pipeline determinístico; LLM só onde exige julgamento | quando a maioria das etapas estiver no degrau 2 |

O agente **não** propõe melhoria genérica. Propõe a partir do próprio erro medido, com o caso
concreto. A subida de degrau é aprovada por vocês no grupo — **é mudança no próprio agente,
então não cabe na autonomia dele.**

---

## Limites (o agente para e escala)

- Decisão de negócio: mudar comportamento que o time inteiro sente, política, ou trade-off de
  produto.
- Fora de `src/`: PWA, migration, config de infra.
- Apagar dado de produção — **sempre** OK explícito, sem exceção.
- Suíte fora do baseline depois do fix.
- Família em parada (reincidiu 2×).
- Não conseguiu reproduzir.

## Erros e degradação

Nunca deixa silêncio: toda saída — sucesso, refutação, falha, timeout — vira mensagem no
grupo. Se o processo morrer no meio, o drain hook já avisa (implementado em 08/08). Idempotência
por `ritual_logs` (`ritual_type='gov_agent'`), com janela de retry como o health report.

## Testes

- `governance-agent.test.js`: gate de idempotência, montagem do pedido, parada por família
  reincidente, degradação sem canal de envio.
- `ops-agent.test.js`: os parâmetros novos (`briefing`, `timeoutMs`) não mudam o
  comportamento padrão — zero-regressão no canal de ops que já está no ar.
- O placar é função pura sobre linhas de `tom_known_issues`: testável com fixture real.

## Fora de escopo (YAGNI)

- Corrigir PWA, migrations, infra.
- Mais de um achado por rodada.
- Interface web — a entrega é o WhatsApp.
- Aprender sozinho a subir de degrau: ele **propõe**, vocês aprovam.
