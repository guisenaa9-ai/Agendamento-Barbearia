-- Exige verificação em duas etapas (código do app autenticador) para o chefe e para a Kryon.
-- Antes de rodar: entre uma vez em admin.html e kryon.html e ative a verificação pelo QR Code.
-- Sem o código, a senha sozinha não dá acesso a nenhum dado da barbearia.
begin;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admins where user_id=auth.uid())
  and coalesce(auth.jwt()->>'aal','aal1')='aal2';
$$;
create or replace function public.is_kryon_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.kryon_admins where user_id=auth.uid())
  and coalesce(auth.jwt()->>'aal','aal1')='aal2';
$$;
commit;

-- Para desfazer (ex.: o chefe perdeu o celular), rode as duas funções sem a linha do aal:
--   create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
--    select exists(select 1 from public.admins where user_id=auth.uid()); $$;
--   create or replace function public.is_kryon_admin() returns boolean language sql stable security definer set search_path='' as $$
--    select exists(select 1 from public.kryon_admins where user_id=auth.uid()); $$;
-- E para o chefe cadastrar um celular novo, apague o fator antigo dele:
--   delete from auth.mfa_factors where user_id=(select id from auth.users where email='EMAIL_DO_CHEFE');
