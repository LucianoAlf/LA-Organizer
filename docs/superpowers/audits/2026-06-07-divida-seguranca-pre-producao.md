# Dívida de Segurança — tratar ANTES de abrir pra clientes (Fatia I)

**Data:** 2026-06-07 · **Decisão do Alf:** dev single-user aceita a dívida agora; **nada aplicado** nesta fase. Este doc é o checklist pré-produção.
**Origem:** auditoria completa 07/06 (dossiê `2026-06-07-auditoria-completa-achados.md`). Itens confirmados pelo cético.

> ⚠️ Por que NÃO aplicar agora: ligar RLS sem as policies certas **bloqueia o acesso** (o próprio advisor do Supabase avisa). Cada item abaixo precisa ser feito + testado com calma antes de produção.

## 1. [ALTO] 4 tabelas com RLS DESLIGADA + grant total pra anon/authenticated
Tabelas: `event_category_leaders`, `voice_message_log`, `task_classifications`, `webhook_queue`. Qualquer um com a anon key lê/escreve tudo.
**Fix pré-prod:** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **junto** com as policies adequadas (a maioria deve ser service-role-only; `event_category_leaders` é lookup → SELECT pra authenticated). Testar acesso do PWA + engine logo depois (engine usa service_role → não afetado).

## 2. [ALTO] `VITE_INTERNAL_API_SECRET` embutido no bundle do cliente
Os endpoints `/internal/*` (event-invites, task-delegated, project-created, etc.) são protegidos só por esse segredo, que vai no JS do navegador → qualquer um extrai e dispara os endpoints.
**Fix pré-prod:** validar o **JWT do Supabase** no engine (em vez do segredo compartilhado), ou mover as chamadas `/internal/*` pra um proxy server-side. Rotacionar o segredo ao migrar.

## 3. [ALTO] `governance_credentials` guarda segredos em TEXTO PURO
Chaves reais (OpenAI/Gemini/Waha) sem criptografia em repouso (18 linhas).
**Fix pré-prod:** criptografar em repouso (pgcrypto / Vault / secrets manager) ou mover pra env. Restringir RLS a service-role. Rotacionar as chaves expostas.

## 4. [MÉDIO] Token UAZAPI hardcoded como fallback em 2 edge functions
Commitado no repo.
**Fix pré-prod:** remover o fallback hardcoded; exigir a env var (falhar explícito se ausente). Rotacionar o token.

## 5. [MÉDIO] `send-magic-link`: enumeração de telefones + vaza e-mail + sem rate-limit
Permite descobrir quem está cadastrado e abusar do envio.
**Fix pré-prod:** resposta genérica (não revelar se existe), rate-limit por IP/telefone, não retornar e-mail.

---

**Resumo:** 3 altos + 2 médios. Nenhum é urgente em dev (single-user, sem clientes), mas **todos precisam estar fechados antes do primeiro cliente externo**. Quando for a hora, isto vira uma fatia própria (spec → fix testado item a item).
