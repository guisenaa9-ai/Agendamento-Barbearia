-- Fotos e descrições de serviços. Mantém as permissões existentes de administrador.
begin;
alter table public.services add column if not exists description text not null default '';
alter table public.services add column if not exists photo_url text;
commit;
notify pgrst, 'reload schema';
