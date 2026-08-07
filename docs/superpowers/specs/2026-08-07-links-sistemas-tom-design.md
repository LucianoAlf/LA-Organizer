# Links de sistemas via TOM — design

**Data:** 2026-08-07
**Status:** aprovado, aguardando plano de implementação

## Problema

O time esquece os endereços dos sistemas internos (Anamnese, Chatwoot, LA Performance Report) e pergunta repetidamente. O TOM já é o canal onde essas perguntas chegam, mas não tem acesso a essa informação.

A tabela `governance_credentials` guarda esses links — mas guarda também senhas, API keys e tokens de 40+ credenciais críticas. O TOM não pode ter acesso indiscriminado a ela.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Fonte dos dados | Mesma tabela `governance_credentials` + flag booleana | Evita duplicar cadastro e manter duas telas. Isolamento vem da RPC, não da separação física. |
| Campos expostos | Apenas `nome` e `url_ref` | Superfície mínima. Mesmo que alguém escreva algo sensível em `observacoes` de uma linha marcada, o TOM nunca lê esse campo. |
| Audiência | Todo colaborador ativo | O problema ("o time esquece") é geral. Sem regra de permissão por papel. |
| Acesso ao dado | RPC SQL, não query montada em JS | O contrato `returns table (nome text, url_ref text)` vive no schema. Ampliar o que vaza exige reescrever a função via migration — mudança visível e versionada, não uma linha de `.select()` num PR. |
| Gatilho | Marker emitido pelo modelo (two-pass) | Requisito explícito do usuário: decisão semântica do modelo, não match de texto. Regex-gate e sempre-no-contexto foram considerados e recusados. |
| Tool-calling nativo / MCP | Não | `--tools ''` e `--strict-mcp-config` são hardening deliberado (commit `1f07752b`, incidente 28/04/2026). Não será reaberto. |

## Arquitetura

### 1. Banco (migration)

```sql
alter table governance_credentials
  add column visivel_tom boolean not null default false;

create or replace function get_team_links()
returns table (nome text, url_ref text)
language sql stable
as $$
  select nome, url_ref
  from governance_credentials
  where visivel_tom = true
    and status = 'ok'
    and url_ref is not null
  order by nome;
$$;

revoke execute on function get_team_links() from anon, authenticated;
```

O `revoke` é obrigatório: a anon key do Supabase está no bundle público do PWA. Sem ele, qualquer pessoa na internet poderia chamar a RPC e enumerar os sistemas internos da escola. Apenas a `service_role` (usada pelo TOM) executa.

`default false` garante que as 40+ credenciais existentes permanecem invisíveis sem nenhuma ação.

### 2. Serviço — `src/services/team-links.js`

- `getTeamLinks()` chama `supabase.rpc('get_team_links')`.
- Cache em memória, TTL 30min, seguindo o padrão de `src/services/audio.js:36-52` (`_namesCache`).
- Em erro: loga warning e retorna o cache stale, ou `[]` se nunca populou. Nunca lança — falha de link não pode derrubar o pipeline da mensagem.
- Cap de 30 itens ao renderizar.

### 3. Marker — `<<PEDIR_LINKS>>`

Instrução fixa no system prompt (~50 tokens):

> Se o colaborador pedir o link, endereço ou acesso de algum sistema e você não tiver essa informação, responda apenas `<<PEDIR_LINKS>><<END>>` e mais nada. A lista será fornecida e você responderá em seguida.

Marker sem payload — o modelo não escolhe o que buscar, apenas sinaliza que precisa da lista.

### 4. Engine — segunda chamada

Precedente: `src/engine.js:12963` já faz `ai.chat()` numa segunda passada (auto-retry de marker ausente).

Fluxo:

1. Resposta do modelo chega. Engine detecta `<<PEDIR_LINKS>>`.
2. Chama `getTeamLinks()`.
3. Monta prompt curto: lista + pergunta original do colaborador + instrução de resposta seletiva.
4. Segunda chamada ao modelo. **Nessa chamada, a instrução do `<<PEDIR_LINKS>>` não é incluída** — guard anti-loop.
5. Resposta final vai pro WhatsApp. O marker é removido do texto antes do envio.

**Guard anti-loop (obrigatório):** a segunda chamada nunca pode disparar uma terceira. Se a resposta da segunda passada contiver `<<PEDIR_LINKS>>`, o marker é apenas removido do texto e a resposta segue como está. Máximo de uma re-chamada por mensagem, sempre.

**Instrução de resposta seletiva:** responder apenas o link perguntado. Listar todos somente se pedirem explicitamente quais sistemas existem.

**Degradação:** lista vazia ou RPC falhando → responde que não tem essa informação cadastrada. Nunca trava a mensagem, nunca vaza erro técnico (o guard anti-leak de `engine.js` já bloqueia menções a "supabase", "tabela", "sql" etc.).

### 5. Cadastro inicial

`update governance_credentials set visivel_tom = true` nas três linhas criadas em 2026-08-07: Anamnese de alunos, Chatwoot — CRM da empresa, LA Performance Report — ERP principal.

## Riscos conhecidos

**O TOM esquece de emitir markers.** É uma falha medida deste agente — o check `actionable_no_marker` do health report diário existe precisamente para monitorar isso ("promessas sem persistência"). Se ele esquecer o `<<PEDIR_LINKS>>`, responderá que não sabe em vez de buscar. Mitigação: instrução explícita no prompt; observar em produção.

**Latência dobra nos turnos com marker.** De 8-12s para ~16-24s. Aceitável para um caso de uso pontual.

**Disciplina de cadastro.** Marcar `visivel_tom = true` numa linha que contenha senha nos `campos` não vaza a senha (a RPC não a expõe), mas expõe o `nome` e a `url_ref` daquela credencial. O nome deve ser sempre revisado antes de marcar.

## Fora de escopo

- Toggle na tela de Credenciais para gerenciar a flag pela UI (por ora, `update` via SQL).
- Qualquer marker ou caminho de escrita que altere `visivel_tom` por WhatsApp. A promoção de uma credencial a "visível" é deliberadamente impossível por conversa.
- Telegram como canal.

## Critérios de aceite

1. `get_team_links()` retorna apenas linhas com `visivel_tom = true`, `status = 'ok'` e `url_ref` não nulo — e apenas as colunas `nome` e `url_ref`.
2. `revoke` verificado: chamada da RPC com a anon key é negada.
3. Pergunta direta ("qual o link da anamnese?") retorna o link correto, sem listar os demais.
4. Pergunta sem relação com links não dispara segunda chamada.
5. Resposta da segunda passada contendo `<<PEDIR_LINKS>>` não gera terceira chamada.
6. RPC indisponível não impede a mensagem de ser respondida e enviada.
7. Nenhuma credencial com `visivel_tom = false` aparece em nenhum caminho.
