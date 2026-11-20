-- Faixa de aviso no topo do site do cliente. O chefe escreve em Campanhas → Aviso no site.
-- O site público lê só o texto, pela função site_announcement() (shop_settings continua fechada para visitantes).
-- Repetível.
begin;
alter table public.shop_settings add column if not exists announcement text
 check(announcement is null or length(trim(announcement)) between 1 and 140);
create or replace function public.site_announcement()
returns text language sql stable security definer set search_path='' as $$
 select nullif(trim(announcement),'') from public.shop_settings where id=1;
$$;
revoke all on function public.site_announcement() from public;
grant execute on function public.site_announcement() to anon,authenticated;
commit;
notify pgrst,'reload schema';
