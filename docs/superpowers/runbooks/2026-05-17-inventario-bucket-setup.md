# Runbook: Setup do bucket `inventario-fotos` (LA Report)

**Data:** 2026-05-17
**Sprint:** Inventário Bidirecional (Fase A) — Task 1
**Projeto Supabase:** LA Report (`ouqwbbermlzqqvtqwlul`)

## Contexto

O bucket `inventario-fotos` armazena as fotos dos itens do inventário bidirecional. O fluxo é:

- A PWA envia a foto para uma serverless function na Vercel.
- A function usa o `service-role key` do LA Report para fazer upload no bucket.
- A PWA exibe a foto via `<img src>` apontando para a URL pública — por isso o bucket precisa ser **público para leitura**.

Este runbook documenta os passos manuais (não automatizados via MCP) para criar o bucket. Execute uma vez; guarde para repetir o setup se necessário (ex.: novo ambiente).

---

## Passo 1 — Criar o bucket pelo Dashboard

1. Acessar: https://supabase.com/dashboard/project/ouqwbbermlzqqvtqwlul/storage/buckets
2. Clicar em **"New bucket"**
3. Preencher:
   - **Name:** `inventario-fotos`
   - **Public bucket:** **ON**
   - **File size limit:** `5 MB`
   - **Allowed MIME types:** `image/jpeg, image/png, image/webp`
4. Clicar em **"Save"**

## Passo 2 — Adicionar policy de leitura pública

Abrir o SQL Editor do LA Report e executar:

```sql
CREATE POLICY "Public read inventario-fotos" ON storage.objects
  FOR SELECT USING (bucket_id = 'inventario-fotos');
```

> Observação: marcar o bucket como público no Dashboard já cria a policy padrão na maioria dos casos, mas executar este SQL garante idempotência e deixa a intenção explícita.

## Passo 3 — Smoke test

Substituir `$LA_REPORT_SERVICE_ROLE_KEY` pelo valor real (variável de ambiente local).

```bash
# Upload de teste (precisa do service-role key)
curl -X POST 'https://ouqwbbermlzqqvtqwlul.supabase.co/storage/v1/object/inventario-fotos/test.txt' \
  -H "Authorization: Bearer $LA_REPORT_SERVICE_ROLE_KEY" \
  -H "Content-Type: text/plain" \
  --data-binary "hello"

# Leitura pública (sem auth)
curl 'https://ouqwbbermlzqqvtqwlul.supabase.co/storage/v1/object/public/inventario-fotos/test.txt'
# Esperado: hello
```

**Cleanup:** após validar, deletar o arquivo `test.txt` manualmente pelo Dashboard:
https://supabase.com/dashboard/project/ouqwbbermlzqqvtqwlul/storage/buckets/inventario-fotos

---

## Critérios de sucesso

- [ ] Bucket `inventario-fotos` aparece listado no Dashboard como público.
- [ ] Upload via `curl` retorna 200 OK.
- [ ] Leitura pública retorna `hello`.
- [ ] `test.txt` removido após o teste.
