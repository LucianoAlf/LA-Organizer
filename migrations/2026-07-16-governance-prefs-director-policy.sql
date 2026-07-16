-- 2026-07-16 — Toggle do digest de governança no painel (Gestão da Equipe → ficha da pessoa).
-- Alf pediu: "tem que ter um botão pra eu desligar essa parada" (Bianca/Anne recebiam o
-- digest de líder por estarem na matriz, mas ainda nem começaram a cobrar time).
--
-- O backend JÁ suportava (governance_prefs.digest_enabled; dispatcher respeita nas linhas
-- 3042 e 3137). O que faltava era a UI + ESTA policy: gov_prefs_self só permite a PRÓPRIA
-- linha, então o director gravaria 0 linhas em silêncio ao editar a pref de outro.
--
-- Restrito a 'director' de propósito: coordinator NÃO pode mexer na pref de outro
-- coordinator (a Bianca é coordinator). Segue o padrão da casa (current_collab_role(),
-- usado em la_journey_programas / project_members). APLICADA via MCP em 16/07.
create policy gov_prefs_director on governance_prefs
  for all
  using (current_collab_role() = 'director')
  with check (current_collab_role() = 'director');
