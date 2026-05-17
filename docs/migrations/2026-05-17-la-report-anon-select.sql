-- Migration: Permite anon SELECT em tabelas operacionais do LA Report
-- Aplicar em: LA Report Supabase (ouqwbbermlzqqvtqwlul) — SQL Editor
-- Sprint: Inventário Bidirecional Fase A
-- Data: 2026-05-17
--
-- Contexto: A PWA do LA Organizer lê o LA Report diretamente via cliente
-- Supabase com anon key (decisão arquitetural Abordagem A do spec). As
-- tabelas abaixo tinham RLS só pra authenticated, fazendo a PWA ver vazio.
-- Writes continuam exclusivamente via service-role do serverless (autorizado
-- por checkAccess + auditoria "via PWA por <nome>").
--
-- Tradeoff aceito: anon key é pública (vai no bundle JS); reads ficam
-- expostas a qualquer um com a URL. OK pra inventário/lojinha (não é dado
-- sensível por unidade); writes seguem gatadas no servidor.

BEGIN;

-- Salas (já tinha SELECT pra admin/get_user_unidade_id; adiciona anon)
CREATE POLICY "anon_select_salas" ON public.salas
  FOR SELECT TO anon USING (true);

-- Inventário e tabelas relacionadas
CREATE POLICY "anon_select_inventario" ON public.inventario
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_inventario_movimentacoes" ON public.inventario_movimentacoes
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_inventario_manutencoes" ON public.inventario_manutencoes
  FOR SELECT TO anon USING (true);

-- Loja
CREATE POLICY "anon_select_loja_produtos" ON public.loja_produtos
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_loja_estoque" ON public.loja_estoque
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_select_loja_categorias" ON public.loja_categorias
  FOR SELECT TO anon USING (true);

COMMIT;

-- Verificação (rode separado após o COMMIT):
-- SELECT tablename, policyname, roles, cmd
--   FROM pg_policies
--  WHERE schemaname='public'
--    AND tablename IN ('salas','inventario','inventario_movimentacoes','inventario_manutencoes','loja_produtos','loja_estoque','loja_categorias')
--    AND 'anon' = ANY(roles)
--  ORDER BY tablename;
