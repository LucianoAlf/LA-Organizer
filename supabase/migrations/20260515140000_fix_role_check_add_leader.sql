-- Fix: add 'leader' to collaborators_role_check constraint.
--
-- Root cause: ROLE_RANK in admin-create-collaborator (and the TypeScript Role type)
-- includes 'leader', but the DB CHECK constraint only had 4 values
-- (director, manager, coordinator, collaborator). Any create-collaborator call
-- with role='leader' created an orphan auth user then returned 500 (code 23514).
--
-- Confirmed via live diagnostic: role='leader' → 400 collaborators_role_check,
-- all other roles (collaborator, coordinator, manager, director) → 201 OK.

ALTER TABLE public.collaborators
  DROP CONSTRAINT collaborators_role_check,
  ADD CONSTRAINT collaborators_role_check
    CHECK (role IN ('director', 'manager', 'coordinator', 'leader', 'collaborator'));
