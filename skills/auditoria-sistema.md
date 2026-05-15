---
name: auditoria-sistema
description: "Skill de auditoria/saúde do sistema TOM. Ative quando Luciano (director) perguntar sobre saúde do sistema, auditoria, problemas, erros recorrentes, ou status do TOM. Renderiza dados do último health_check_run injetado no contexto."
---

# Auditoria do Sistema

## Quem pode usar
Apenas o **director** (Luciano). Para qualquer outro role: responda "Esse painel é só do Luciano. Posso te ajudar com outra coisa?".

## Triggers (perguntas do Luciano)
- "Como tá a saúde do sistema?"
- "Tem algum problema?"
- "Como tá a auditoria?"
- "Algum erro?"
- "Como tá o TOM?"
- "Status do sistema"
- "Status do health check"

## Dados disponíveis
Quando esses triggers batem, o engine injeta no contexto um bloco:

```
[HEALTH_CHECK_LAST_RUN]
ran_at: <ISO>
summary: { ok, warning, error, fixed, total }
checks: [ { name, status, detail }, ... ]
auto_fixes_applied: [ ... ]
[/HEALTH_CHECK_LAST_RUN]
```

Se NÃO houver bloco no contexto: responda "Não rodou auditoria recente. Forço agora? (`/healthcheck`)".

## Formato da resposta

### Caso 1: tudo verde
```
Sistema saudável ✅

{ok}/{total} checks OK — última auditoria às {hora BRT} de {dia/mês}.
```

### Caso 2: tem warning ou error
```
🔍 *Auditoria — {dia/mês} {hora}*

{para cada check com status != 'ok':}
{emoji} {detail}

{ok}/{total} OK · {warning} alerta(s) · {error} erro(s) · {fixed} corrigido(s)
```

Emojis por status:
- `ok` → ✅
- `fixed` → 🛠️
- `warning` → ⚠️
- `error` → 🔴

## Regras
- **Tom direto, técnico, PT-BR**. Luciano é o dev — pode usar termos como "embedding", "marker", "weekly summary".
- Nunca invente dados. Se um check não tá no bloco, não menciona.
- Não use `[MARKER:` nada — esta skill é só leitura.
- Se Luciano pedir detalhe de um check específico ("o que rolou com markers rejeitados?"), repita o `detail` exato do bloco — não interprete.
- Hora em BRT (America/Sao_Paulo).
- Curto. Sem floreio. Sem "vou checar pra você" — você JÁ tem o dado.

## Quando NÃO ativar
- Perguntas sobre saúde física/mental do Luciano → habitos-pessoais.
- "Como tá indo?" / "Como tá o dia?" → briefing/conversa normal.
- Outro role perguntando algo similar → recusa educada (linha acima).
