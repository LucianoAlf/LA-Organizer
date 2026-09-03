# CRUD de credenciais de governança pelo WhatsApp — design

**Data:** 2026-09-03
**Kanban:** LAOR-1
**Status:** aprovado, aguardando plano de implementação

## Problema

As credenciais da empresa vivem em `governance_credentials` (45 registros: senhas, API keys, tokens, contas). Hoje só a tela do PWA registra e edita. Hugo e Luciano precisam disso pelo WhatsApp — o canal onde já operam — para cadastrar uma conta no momento em que ela é criada, e consultar uma senha quando estão fora do computador.

A feature de 07/08 (marker `PEDIR_CREDENCIAIS`, RPC `get_credenciais_publicas`) resolveu só a leitura pública: nome e URL de credenciais marcadas `visivel_tom = true`, para qualquer colaborador. Escrita foi deliberadamente deixada fora naquele spec.

## Modelo de acesso

Um único caminho. **O engine decide o escopo pela pessoa que mandou a mensagem — o modelo não escolhe nada.** Essa é a decisão central do design: cada escolha delegada ao modelo é onde o erro entra (`TASK_UPDATE` erra 14% escolhendo alvo; o financeiro, com executor determinístico, erra 1,3%).

| Quem | Quais credenciais | Quais campos |
|---|---|---|
| Hugo e Luciano (`is_system_admin = true`) | qualquer uma das 45 | tudo: `campos` com valores sensíveis, `observacoes`, metadados |
| Qualquer outro colaborador ativo | só `visivel_tom = true` (hoje 3) | só `nome` e `url_ref` |

Para quem não é admin, a negativa **não revela que a funcionalidade existe** — nada de "credenciais são restritas ao Hugo e ao Luciano", que entrega a quem tentar exatamente o que precisa saber. Resposta genérica do tipo "isso eu não consigo te ajudar, fala com o Luciano".

### Por que uma coluna nova

`role = 'director'` não serve: existem 4 directors ativos (Hugo, Luciano, **Anne Susan** e um **Admin**). Nova coluna `is_system_admin boolean not null default false` em `collaborators`, marcada só para Hugo e Luciano. Isso resolve o `TODO(roadmap): adicionar coluna is_system_admin em collaborators` já escrito em `src/rituals/dispatcher.js`.

### Gate em duas camadas independentes

1. **Engine**: verifica `is_system_admin` do remetente antes de qualquer ação.
2. **RPC**: recebe o `collaborator_id` e valida por conta própria, negando se não for admin.

Se um dia alguém chamar a RPC de outro ponto do código esquecendo o gate da aplicação, ela ainda recusa. Mesma filosofia do `revoke` da feature anterior: a garantia mora no schema, não numa linha de JS que alguém pode remover sem perceber.

## Interfaces — o que é novo e o que muda

**Markers:**

| Marker | Situação |
|---|---|
| `<<PEDIR_CREDENCIAIS>>` | **Já existe** (07/08). Mantido como está, sem payload. Passa a servir os dois perfis — o escopo é decidido pelo engine, não pelo marker. |
| `<<CREDENCIAL_ACTION>>` | **Novo.** Payload JSON com `{action: "create"\|"update"\|"delete", ...}`. Só o modelo *propõe*; o engine valida, confirma e persiste. |

**RPCs:**

| Função | Situação |
|---|---|
| `get_credenciais_publicas()` | **Aposentada.** Substituída pela função abaixo na mesma migration, para não restar duas portas de leitura com regras diferentes. |
| `get_credenciais_para(p_collaborator_id uuid)` | **Nova.** Aplica o escopo internamente: admin recebe tudo de todas; não-admin recebe `nome`/`url_ref` das `visivel_tom = true`. Mesmo `revoke` de `anon`/`authenticated` da anterior. |
| `upsert_credencial(...)` / `delete_credencial(...)` | **Novas.** Recebem o `p_collaborator_id` e negam se não for admin, independentemente do gate do engine. |

O two-pass do `PEDIR_CREDENCIAIS` continua como está: o engine detecta, busca, e faz a segunda chamada com o resultado. A única mudança é a fonte passar a ser `get_credenciais_para` e o conteúdo variar por perfil.

## Escrita — executor determinístico

O modelo **apenas extrai** os dados da mensagem e emite um marker com o que entendeu. O engine é quem decide e persiste. Nenhuma escrita acontece sem confirmação humana.

Sequência para toda escrita (`create`, `update`, `delete`):

1. **Anti-duplicata** (determinística, no engine — não no modelo). Sinais, do mais forte para o mais fraco:
   - valor de campo idêntico (e-mail/login já cadastrado em outra credencial);
   - mesmo `servico` + `projeto`;
   - `nome` similar.
2. **Se houver candidato**, o TOM não cria: mostra o que já existe e pergunta se é para atualizar aquele ou criar um novo de fato.
3. **Resumo antes de gravar**, com valores sensíveis mascarados (`senha: ●●●●●●`).
4. **Só persiste após confirmação** explícita.

Para `update` e `delete`, o alvo é resolvido pelo engine; havendo ambiguidade, ele pergunta em vez de escolher. Errar o alvo aqui significa sobrescrever ou apagar a senha errada.

### Duplicata: o caso real que motivou isso

O exemplo que o Hugo deu ("conta do ADS Google", `la.tecnology.system@gmail.com`) tem duas credenciais preexistentes que falam de Google Ads: **"Gmail — Escola de Música LA (YouTube/Google Ads)"** (observação: "Conta do YouTube e do Google Ads.") e **"Gmail — LA Music Barra"** ("Usado no Gmail e possivelmente no Google Ads (a confirmar)."). O e-mail em si ainda não está cadastrado, então seria um registro legítimo — mas sem a checagem o TOM criaria um terceiro registro sobre Google Ads em silêncio, espalhando a informação que a governança existe para consolidar.

## Leitura

Mesma RPC atende os dois perfis, com o escopo aplicado a partir do `collaborator_id` recebido. Para admin devolve `nome`, `categoria`, `servico`, `projeto`, `responsavel`, `url_ref`, `status`, `observacoes` e `campos` (com valores). Para não-admin, apenas `nome` e `url_ref` das linhas `visivel_tom = true`.

- **`observacoes` entra na resposta** — é o campo markdown que dá o contexto do que a credencial é. Sem ele a consulta devolve dados soltos sem significado.
- **Conversão de formato**: o markdown do banco (`# títulos`, `> [!critico]`, tabelas) não é renderizado pelo WhatsApp e apareceria cru. A saída converte para formatação de WhatsApp (`*negrito*`, `_itálico_`, bullets). O conteúdo original permanece intacto no banco, para o PWA continuar renderizando.
- **Credenciais com muitos campos**: "Sol — Atendimento" tem 14 campos, vários deles senhas distintas. A resposta mostra os primeiros e oferece "tem mais N campos, quer ver todos?" — despejar 14 segredos numa consulta pontual é ruim, e o acesso completo continua a um pedido de distância.

## Descrição gerada

Quando o cadastro não vier com descrição, o TOM gera uma observação curta em markdown com o que dá para inferir com segurança — serviço, para que serve, data do cadastro, quem cadastrou — marcada como gerada automaticamente. Evita registro sem contexto; o Hugo refina no PWA quando quiser.

A descrição gerada **nunca** inventa fato sobre a credencial que não esteja na mensagem (para que serve, quem usa, criticidade). Na dúvida, escreve menos.

## Exposição do segredo

Decisão consciente do Hugo: a senha trafega pelo WhatsApp. Hoje ela existe em 1 lugar; com a feature, em 5.

| Onde | Mitigação |
|---|---|
| `governance_credentials.campos` | Nenhuma — já é assim hoje via PWA (texto plano com flag `sensivel`) |
| `conversation_history` | **Redigir**: grava `***` no lugar do valor sensível |
| `marker_logs.raw_excerpt` | **Não gravar** o texto cru para os markers desta feature (`logMarker` com `raw = null`) |
| WhatsApp do Hugo e do Luciano + backup em nuvem | Impossível mitigar — aceito |
| UAZAPI (provedor terceiro) | Impossível mitigar — aceito |

## Isenção estreita do anti-leak

O guard `STACK_LEAK_RE` (`src/engine.js`) substitui a resposta inteira por uma mensagem genérica quando ela contém `supabase`, `postgres`, `banco de dados`, `mcp` ou `sql`. Medido na base atual: **até 4 das 45 credenciais** batem nesse filtro (2 no `nome`, 1 em `observacoes`, 2 em `campos`) — entre elas "Mila Supabase", "Hostinger API (MCP)" e "Sol — Atendimento". Consultar qualquer uma devolveria `_tive um problema interno aqui_` sem explicação.

O guard existe para pegar o **modelo improvisando** sobre a stack interna (incidente de 28/04, quando o TOM disse "preciso de permissão pra acessar o Supabase"). Numa resposta de credencial o texto veio de uma RPC controlada, não de improviso — a premissa do guard não se aplica.

Portanto: o caminho da RPC de credenciais marca a resposta como isenta, e o guard respeita essa marca. A isenção é **estreita e explícita** — vale só para respostas construídas a partir do retorno da RPC, nunca global, e nunca para texto livre do modelo.

## Fora de escopo

- **Grupos.** O fluxo de grupo usa `buildGroupChatPrompt`, um prompt separado de `buildSystemPrompt` — nada desta feature entra lá. Credencial nunca é registrada nem exibida em grupo, por construção.
- **Alterar `visivel_tom` por conversa.** Promover uma credencial a pública continua sendo possível apenas pelo PWA ou por SQL.
- **Cifrar os valores no banco.** Hoje o PWA já grava em texto plano. Se virar prioridade, é um projeto próprio, porque afeta a tela também.

## Riscos conhecidos

**O TOM esquece de emitir markers.** Falha medida deste agente — é o `actionable_no_marker` do health report diário. Aqui o efeito é benigno: ele responde que não entendeu, e nada é gravado errado. O executor determinístico garante que um marker mal-emitido não vira escrita silenciosa.

**Identificação de alvo em `update`/`delete`.** É a classe de falha que custa 14% no `TASK_UPDATE`. Mitigada pela confirmação obrigatória e pelo engine perguntar em vez de escolher — mas nunca eliminada. Por isso o delete exige confirmação sempre.

**Superfície de engenharia social.** Alguém pode tentar convencer o TOM a entregar credencial se passando por Hugo. O gate é pelo `collaborator_id` resolvido a partir do telefone, não por nada que a pessoa escreva — então isso exigiria acesso ao aparelho ou ao número, não só ao TOM.

## Critérios de aceite

1. Colaborador sem `is_system_admin` não obtém nenhum valor sensível nem qualquer credencial com `visivel_tom = false`, por nenhum caminho ou frase.
2. A negativa a não-admin não revela a existência da funcionalidade.
3. A RPC nega sozinha quando recebe um `collaborator_id` que não é admin, mesmo se o gate do engine for removido.
4. Nenhuma escrita (`create`, `update`, `delete`) acontece sem confirmação explícita.
5. Cadastrar algo que já existe oferece editar em vez de criar um duplicado.
6. Consulta de credencial cujo nome ou campos contenham "supabase"/"mcp"/"sql" é entregue normalmente, sem cair no anti-leak.
7. Valor sensível não aparece em `marker_logs.raw_excerpt` nem em texto plano no `conversation_history`.
8. Nada da feature funciona em grupo.
9. `observacoes` aparece na consulta, legível no WhatsApp, com o markdown do banco preservado.
