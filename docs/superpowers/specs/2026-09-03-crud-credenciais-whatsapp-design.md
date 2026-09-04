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
| `conversation_history` | **Redação na entrada** (ver abaixo) |
| `marker_logs.raw_excerpt` | **Não gravar** o texto cru para os markers desta feature (`logMarker` com `raw = null`) |
| `marker_logs.reason` do `ACTIONABLE_NO_MARKER` → **relatório das 7h** | **Redação na entrada** — ver abaixo; é o caminho mais perigoso |
| WhatsApp do Hugo e do Luciano + backup em nuvem | Impossível mitigar — aceito |
| UAZAPI (provedor terceiro) | Impossível mitigar — aceito |

### Redação na entrada, não no ponto de gravação

A mitigação **não pode** ser aplicada arquivo a arquivo em cada `logConversation`. Motivo concreto: `src/engine.js:13643` grava `reason: "text:<primeiros 200 chars da mensagem>"` quando o TOM deixa de emitir marker para uma mensagem acionável. O check `actionable_no_marker` lê esse campo e `formatHealthReport` o renderiza como `_user: "..."` — **enviado por WhatsApp para Hugo e Luciano no relatório das 7h**.

Encadeando: o TOM esquecer o marker é a falha mais comum deste agente; a consequência seria retransmitir a senha por WhatsApp num relatório automático, no dia seguinte. Um `catch` de redação só no `conversation_history` não cobriria isso.

Portanto: assim que o pipeline identificar que a mensagem carrega credencial, **o texto que segue para o resto do pipeline já vai mascarado** (`senha: ***`). Logs, métricas, `marker_logs`, health check e histórico recebem a versão redigida por construção. O valor real segue por um caminho separado, direto para o executor, e é usado apenas para gravar no destino final.

Regra de verificação: qualquer campo que persista texto derivado da mensagem do usuário deve receber a versão mascarada. Não é uma lista de lugares a corrigir — é o texto que circula que precisa ser seguro.

## Isenção estreita do anti-leak

O guard `STACK_LEAK_RE` (`src/engine.js`) substitui a resposta inteira por uma mensagem genérica quando ela contém `supabase`, `postgres`, `banco de dados`, `mcp` ou `sql`. Medido na base atual: **até 4 das 45 credenciais** batem nesse filtro (2 no `nome`, 1 em `observacoes`, 2 em `campos`) — entre elas "Mila Supabase", "Hostinger API (MCP)" e "Sol — Atendimento". Consultar qualquer uma devolveria `_tive um problema interno aqui_` sem explicação.

O guard existe para pegar o **modelo improvisando** sobre a stack interna (incidente de 28/04, quando o TOM disse "preciso de permissão pra acessar o Supabase"). Numa resposta de credencial o texto veio de uma RPC controlada, não de improviso — a premissa do guard não se aplica.

Portanto: o caminho da RPC de credenciais marca a resposta como isenta, e o guard respeita essa marca. A isenção é **estreita e explícita** — vale só para respostas construídas a partir do retorno da RPC, nunca global, e nunca para texto livre do modelo.

## Fatia 0 — cifragem em repouso dos valores sensíveis

Vale por si só, independente do CRUD por WhatsApp: protege as 45 credenciais que já existem. Deve ir antes do resto.

**O projeto já tem esse mecanismo funcionando** — em `notes` e `group_notes`, não nas credenciais:

- `gn_encrypt_secret_fields()` — trigger `BEFORE INSERT/UPDATE` que cifra campos marcados com `pgp_sym_encrypt`, chave lida do Vault (`group_notes_secret_key`, criada em 13/06), gravando com prefixo `enc:v1:`.
- `gn_decrypt(ciphertext)` — decifra; devolve o valor intacto se não tiver o prefixo.
- `reveal_note_secret` / `reveal_personal_note_secret` — checam permissão **antes** de decifrar e levantam `forbidden` se falhar.

Ou seja: notas pessoais estão cifradas em repouso e as senhas da empresa não. Inversão de prioridade, com a solução pronta ao lado.

**O que fazer:** trigger equivalente em `governance_credentials`, cifrando os itens de `campos` com `sensivel: true` (a estrutura daqui é `{label, valor, sensivel}`, não `{value, secret}` — adaptar), mais `reveal_credencial_campo(p_cred_id uuid, p_indice int)` que checa **`is_system_admin`** antes de decifrar.

**Decisão do Hugo:** o `reveal` exige `is_system_admin`, não `director`. Consequência a comunicar antes do deploy: **Anne Susan perde o acesso às senhas pela tela**, que hoje ela tem. Continua vendo as credenciais, com o valor mascarado.

**O que a cifragem resolve e o que não resolve.** Elimina a leitura casual por quem chega ao banco por fora da tela — `service_role`, scripts, dumps, backups, sessões de debug (foi assim que os `campos` foram lidos durante esta própria sessão de design). **Não** protege contra quem tem `service_role` e chama `gn_decrypt` deliberadamente: a chave mora no Vault do mesmo projeto.

**Dois cuidados obrigatórios, aprendidos ao inspecionar o código existente:**

1. **Não replicar a falha muda.** A função atual faz `if k is null then return NEW; end if` — se a chave do Vault sumir ou for renomeada, ela **grava em texto plano e não avisa ninguém**. Na versão para credenciais, `raise exception`: melhor a gravação falhar visivelmente do que a senha ser salva plana em silêncio. Isso é o que o CLAUDE.md do projeto exige de todo caminho de falha.
2. **O mecanismo nunca rodou de verdade.** `group_notes` não tem uma única linha com `enc:v1:` — está implantado desde junho sem nenhum dado cifrado. Não é código validado em produção. Testar o ciclo completo (cifrar → ler → decifrar → permissão negada) com dado descartável antes de tocar nas 45 credenciais reais.

**Impacto no PWA:** a `GovernancaPage` lê `campos` diretamente e passaria a exibir `enc:v1:...`. Precisa chamar a função de reveal. Não é mudança só de banco.

## Fora de escopo

- **Grupos.** O fluxo de grupo usa `buildGroupChatPrompt`, um prompt separado de `buildSystemPrompt` — nada desta feature entra lá. Credencial nunca é registrada nem exibida em grupo, por construção.
- **Alterar `visivel_tom` por conversa.** Promover uma credencial a pública continua sendo possível apenas pelo PWA ou por SQL.
- **Cifrar os valores no banco.** Hoje o PWA já grava em texto plano. Se virar prioridade, é um projeto próprio, porque afeta a tela também.

## Riscos conhecidos

**O TOM esquece de emitir markers.** Falha medida deste agente — é o `actionable_no_marker` do health report diário. Aqui o efeito é benigno: ele responde que não entendeu, e nada é gravado errado. O executor determinístico garante que um marker mal-emitido não vira escrita silenciosa.

**Identificação de alvo em `update`/`delete`.** É a classe de falha que custa 14% no `TASK_UPDATE`. Mitigada pela confirmação obrigatória e pelo engine perguntar em vez de escolher — mas nunca eliminada. Por isso o delete exige confirmação sempre.

**A conta "Admin" (`admin@gmail.com`) vê todas as credenciais.** Colaborador ativo, `role = 'director'`, criado em 24/05 — pela policy atual, alcança as 45 credenciais com senha em texto plano. Investigado durante o design: tem 0 mensagens e 0 markers, mas **813 registros em `ritual_logs`**, porque cinco pontos do `dispatcher.js` buscam `role='director' AND is_active` ordenado por `full_name LIMIT 1` como placeholder de rituais de sistema — e "Admin" é o primeiro alfabeticamente.

Ou seja, a conta é ao mesmo tempo um placeholder técnico legítimo e um furo de acesso. Desativá-la empurraria os rituais para o nome da Anne; trocar o `role` fecharia o acesso sem efeito colateral. **Decisão do Hugo em 03/09: deixar como está.** Fica registrado como risco aceito conscientemente. A fatia 0 reduz o impacto — com a cifragem, essa conta passa a ver os valores mascarados, já que o `reveal` exige `is_system_admin`.

**Superfície de engenharia social.** Alguém pode tentar convencer o TOM a entregar credencial se passando por Hugo. O gate é pelo `collaborator_id` resolvido a partir do telefone, não por nada que a pessoa escreva — então isso exigiria acesso ao aparelho ou ao número, não só ao TOM.

## Critérios de aceite

1. Colaborador sem `is_system_admin` não obtém nenhum valor sensível nem qualquer credencial com `visivel_tom = false`, por nenhum caminho ou frase.
2. A negativa a não-admin não revela a existência da funcionalidade.
3. A RPC nega sozinha quando recebe um `collaborator_id` que não é admin, mesmo se o gate do engine for removido.
4. Nenhuma escrita (`create`, `update`, `delete`) acontece sem confirmação explícita.
5. Cadastrar algo que já existe oferece editar em vez de criar um duplicado.
6. Consulta de credencial cujo nome ou campos contenham "supabase"/"mcp"/"sql" é entregue normalmente, sem cair no anti-leak.
7. Valor sensível não aparece em texto plano em NENHUM campo derivado da mensagem: `conversation_history.content`, `marker_logs.raw_excerpt` e `marker_logs.reason`. Teste explícito: simular o TOM falhando em emitir o marker numa mensagem com senha e conferir que o relatório das 7h não a transmite.
8. Nada da feature funciona em grupo.
9. `observacoes` aparece na consulta, legível no WhatsApp, com o markdown do banco preservado.
10. (fatia 0) Valor com `sensivel: true` fica gravado como `enc:v1:...` — um `select` direto na tabela não devolve senha legível.
11. (fatia 0) `reveal_credencial_campo` nega para quem não é `is_system_admin`, com exceção, sem decifrar.
12. (fatia 0) Chave do Vault ausente faz a gravação **falhar visivelmente**, nunca gravar em texto plano em silêncio.
13. (fatia 0) A tela de Credenciais do PWA continua exibindo os valores para quem é `is_system_admin`.
