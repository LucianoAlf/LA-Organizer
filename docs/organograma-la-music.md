# Organograma LA Music — Referência de Governança
> Documento de referência para o TOM e o sistema de governança do LA Organizer.
> Atualizado em: 15/05/2026 · **Realinhamento de governança: 08/06/2026 (chat Alf)**

---

## ⚙️ Decisões de governança — 08/06/2026 (fonte canônica da dashboard + TOM)

Validadas com o Alf no chat. A tela `/time` e o roteamento do TOM (`leader-routing.js` / `team-routing.ts`) seguem ISTO.

**1. Líderes DE VERDADE (têm time → aparecem no semáforo, recebem digest, têm a view de líder):**
Juliana, Quintela (pedagógico) · Jereh (Campo Grande) · Clayton (Recreio, interino) · Krissya (Barra + Comercial) · Yuri (Marketing).

**2. Reportam DIRETO ao Luciano (sem time → NÃO são líderes, não entram no semáforo):**
Rafinha (Ops Técnicas), Jéssica (Sucesso do Cliente), Fabi (licença), Ana (RH), Rose (Financeiro — *a entrar*).

**Transições futuras (viram líderes quando o time entrar no sistema):**
- **Rafinha** → quando o **Dudu** (estagiário) entrar, passa a liderá-lo.
- **Ana + Rose** → vão liderar as **Farmers (todas)** futuramente.

**3. Pedagógico — os DOIS coordenadores veem TODOS (sem exclusividade):**
- **Todo pedagógico cai em Juliana E Quintela.** "Tudo que a Quintela vê, a Juliana vê" — um lembra o outro. Dai, Matheus, Jordan, Peterson, Ramon, Rodrigo, Leo → **os dois**.
- `supervisor_id` (ex.: Dai→Juliana, Matheus→Quintela) indica o assistente principal de cada um, **mas não restringe a visão**: ambos veem todos.
- **Leo** também → **Krissya** (representante pedagógico operacional da Barra).
- Regra técnica: `function_role='pedagogico'` → adiciona TODOS os coordenadores pedagógicos. Sem filtro de exclusividade.

**4. Anne Susan (sócia, mesma autoridade):** TEM o poder/visão de diretora, **MAS o TOM NUNCA envia governança pra ela** (digest/cobrança/alerta). Ela usa o LA Organizer só pra coisas pessoais; tudo de empresa chega no Luciano, que repassa.

**5. Hugo (Coord. de Tecnologia):** mantém `role=director` (acesso máximo aos sistemas), **mas NÃO recebe nada de governança** e **não é líder** (sem time).

**6. Admin:** conta de sistema → **fora da governança** (não é pessoa).

> **Não-recebem-governança-do-TOM:** Anne, Hugo, Admin. **(implementar no digest — Fase 6.)**

---

## Direção (mesmo nível de autoridade)

| Nome | Role no banco | Unit | Supervisor |
|---|---|---|---|
| Luciano Alf | director | all | — (topo) |
| Anne Susan | director | all | — (sócia, mesmo nível que Luciano) |

**Regra:** a equipe se reporta primariamente ao Luciano, mas Anne Susan tem a mesma autoridade.

---

## Camada 2 — Suporte Central (todas as unidades)

### Coordenação Pedagógica

| Nome | Role | Especialidade | Supervisor |
|---|---|---|---|
| Juliana | coordinator / lead | LA Music **School** | Luciano |
| Quintela | coordinator / lead | LA Music **Kids** | Luciano |

**Exclusivo da Juliana (School):**
- Dai — Assistente Pedagógico

**Exclusivo do Quintela (Kids):**
- Matheus Felipe — Assistente Pedagógico

**Sob o guarda-chuva dos DOIS (Juliana + Quintela):**
- Jordan — Assistente Pedagógico / Eventos
- Peterson — Mentor Pedagógico
- Kinho — Mentor Pedagógico
- Ramon — Assistente Pedagógico / Projeto Bandas
- Rodrigo — Assistente Pedagógico *(chegando em breve)*
- Renan — Mentor Pedagógico

> **Regra crítica para o TOM:** quando uma demanda envolver Jordan, Peterson, Kinho, Ramon, Rodrigo ou Renan, notificar **ambos** — Juliana E Quintela. Não é roteamento para um só.

> Juliana e Quintela coordenam as 3 unidades. Leo (Barra) é a extensão pedagógica local, reporta operacionalmente à Krissya e pedagogicamente à coordenação.

---

### Marketing

| Nome | Role | Função | Supervisor |
|---|---|---|---|
| Yuri | manager / unit=all | Líder de Marketing | Luciano |
| John | — *(ainda não no sistema)* | Videomaker | Yuri |
| Rayan | — *(ainda não no sistema)* | Tráfego Pago (Home Office) | Yuri |

---

### Operações Técnicas + Logística

| Nome | Role | Função | Supervisor |
|---|---|---|---|
| Rafinha | collaborator / unit=all | Operações Técnicas + Logística de Eventos | Luciano |
| Dudu | — *(ainda não no sistema)* | Estagiário (base Campo Grande) | Rafinha |

> Rafinha reporta a Luciano mas trabalha em conjunto com coordenação, gerentes e assistentes pedagógicos conforme o contexto da demanda.

---

### Liderança Comercial

| Nome | Função extra | Cobertura |
|---|---|---|
| Krissya | Líder Comercial | Todas as unidades |

> Krissya tem dupla função: Gerente de Relacionamento da Barra + Líder Comercial (KPIs, campanhas, reuniões semanais com time comercial das 3 unidades).

---

### Backoffice / Suporte Administrativo

| Nome | Função | Modalidade | Status |
|---|---|---|---|
| Rose | Financeiro | Home Office | *(ainda não no sistema)* |
| Ana | RH | Presencial | *(ainda não no sistema)* |
| Jéssica | Sucesso do Cliente | Presencial | *(ainda não no sistema)* |

---

### Tecnologia

| Nome | Role no banco | Função | Supervisor |
|---|---|---|---|
| Hugo | collaborator | Coordenador de Tecnologia — suporte e desenvolvimento dos sistemas internos | Luciano |

---

## Camada 1 — Unidades (3 unidades)

### Campo Grande

| Nome | Função | Supervisor |
|---|---|---|
| **Jereh** | Gerente de Relacionamento | Luciano |
| Gabi | Farmer (recepção) *(fora do sistema)* | Jereh |
| Jhonatan | Farmer (recepção) *(fora do sistema)* | Jereh |
| Vitória | Hunter (comercial presencial) *(fora do sistema)* | Jereh |
| Andreza | SDR Humana — WhatsApp/DM Instagram (agendamentos) *(fora do sistema)* | Jereh |
| Neuza | Conservação e limpeza *(fora do sistema)* | Jereh |
| Dudu | Estagiário Ops Técnicas (base Campo Grande) *(fora do sistema)* | Rafinha |

---

### Recreio

| Nome | Função | Supervisor | Obs |
|---|---|---|---|
| **Clayton** | Gerente de Relacionamento **Interino** | Luciano | cobrindo Fabi (licença maternidade) |
| Fefê | Farmer (recepção) *(fora do sistema)* | Clayton | — |
| Daiana | Farmer (recepção) *(fora do sistema)* | Clayton | — |
| Clayton | Hunter (comercial presencial) | Clayton | dupla função |
| **Fabi** | Gerente titular *(licença maternidade)* | Luciano | provável não retorno; possível transição para Sucesso do Cliente |

---

### Barra

| Nome | Função | Supervisor | Obs |
|---|---|---|---|
| **Krissya** | Gerente de Relacionamento | Luciano | também Líder Comercial (todas) |
| Arthur | Farmer (recepção) *(fora do sistema)* | Krissya | — |
| Duda | Farmer (recepção) *(fora do sistema)* | Krissya | licença maternidade |
| Kailane | Hunter (comercial presencial) *(fora do sistema)* | Krissya | — |
| **Leo** | Assistente Pedagógico local (Rep. Pedagógico da Barra) | Krissya (operacional) + Coordenação (pedagógico) | único assist. ped. baseado em unidade |

---

## Transversal — atuam em todas as unidades

### Mila — SDR IA
- Função: pré-atendimento automático no WhatsApp e DM do Instagram
- Cobertura: Campo Grande, Recreio e Barra simultaneamente
- Encaminha leads qualificados para a equipe comercial local de cada unidade
- *(ainda não no sistema como collaborator)*

### Professores
- Trabalham em 1, 2 ou 3 unidades (perfis variados)
- **Reportam ao Gerente da unidade:** dia-a-dia, comportamento, convivência presencial
- **Reportam à Coordenação (Juliana/Quintela):** parte pedagógica, treinamento, desenvolvimento
- *(ainda não no sistema — entrarão em fase posterior)*

---

## Regras de escalação (para o TOM)

| Contexto da demanda | Quem o TOM escala |
|---|---|
| Problema operacional na unidade | Gerente da unidade (Jereh/Clayton/Krissya) |
| Problema pedagógico / professor | Juliana (School) ou Quintela (Kids) + Gerente da unidade |
| Demanda de equipamento/técnica | Rafinha → se urgente, copia Gerente da unidade |
| Demanda comercial | Krissya (Líder Comercial) |
| Demanda de marketing | Yuri |
| Escalação máxima (não resolvida em 20min) | Luciano ou Anne Susan |

---

## Duplas funções (atenção especial)

| Pessoa | Função 1 | Função 2 |
|---|---|---|
| Krissya | Gerente de Relacionamento — Barra | Líder Comercial — todas as unidades |
| Clayton | Gerente Interino — Recreio | Hunter — Recreio |
| Leo | Assistente Pedagógico (Coordenação) | Rep. Pedagógico local da Barra (Gerência) |

---

## Pessoas fora do sistema (Fase 2 — entrada em ~2 semanas)

Campo Grande: Gabi, Jhonatan, Vitória, Andreza, Neuza, Dudu
Recreio: Fefê, Daiana, Fabi
Barra: Arthur, Duda, Kailane
Suporte: Rose, Ana, Jéssica, John, Rayan, Rodrigo (chegando), Mila (SDR IA)

---

## Estado atual do banco (collaborators já cadastrados)

```
Luciano Alf    director    all     supervisor: —
Anne Susan     director    all     supervisor: —
Juliana        coordinator all     supervisor: Luciano  (pedagogical_role: lead)
Quintela       coordinator all     supervisor: Luciano  (pedagogical_role: lead)
Jereh          manager     campo_grande  supervisor: Luciano
Clayton        manager     recreio       supervisor: Luciano
Krissya        manager     barra         supervisor: Luciano
Yuri           manager     all           supervisor: Luciano
Rafinha        collaborator all          supervisor: Luciano
Hugo           collaborator —            supervisor: Luciano  (Coord. Tecnologia)
Leo            collaborator barra        supervisor: Krissya  (pedagogical_role: assistant)
Dai            collaborator —            supervisor: Juliana  (pedagogical_role: assistant) ← exclusivo Juliana
Matheus Felipe collaborator —            supervisor: Quintela (pedagogical_role: assistant) ← exclusivo Quintela
Jordan         collaborator —            supervisor: Luciano  (pedagogical_role: assistant) ← guarda-chuva Juliana+Quintela
Peterson       collaborator —            supervisor: Luciano  (pedagogical_role: mentor)    ← guarda-chuva Juliana+Quintela
Kinho          collaborator —            supervisor: Luciano  (pedagogical_role: mentor)    ← guarda-chuva Juliana+Quintela
Ramon          collaborator —            supervisor: Luciano  (pedagogical_role: assistant) ← guarda-chuva Juliana+Quintela
Rodrigo        collaborator —            supervisor: Luciano  (pedagogical_role: assistant) ← guarda-chuva Juliana+Quintela
Renan          collaborator —            supervisor: Luciano  (pedagogical_role: mentor)    ← guarda-chuva Juliana+Quintela
```
