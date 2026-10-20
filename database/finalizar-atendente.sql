-- Trecho final do perfil de atendente (o resto já foi aplicado pelo conector).
-- Cole no SQL Editor do Supabase e clique em Run, nos dois projetos. Pode rodar mais de uma vez.
begin;
-- Chefe libera ou remove o acesso da atendente pelo e-mail.
create or replace function public.admin_set_attendant(p_email text,p_allow boolean)
returns text language plpgsql security definer set search_path='' as $$
declare account uuid; clean text:=lower(trim(coalesce(p_email,'')));
begin
 if not public.is_admin() then raise exception 'Acesso permitido somente ao chefe.'; end if;
 select id into account from auth.users where lower(email)=clean;
 if account is null then raise exception 'Esse e-mail ainda não tem conta. Peça para a pessoa criar a conta pelo site e tente de novo.'; end if;
 if p_allow then
  insert into public.attendants(user_id,email) values(account,clean) on conflict(user_id) do update set email=excluded.email;
  return 'liberado';
 end if;
 delete from public.attendants where user_id=account;
 return 'removido';
end;$$;
revoke all on function public.admin_set_attendant(text,boolean) from public,anon;
grant execute on function public.admin_set_attendant(text,boolean) to authenticated;
-- Remove o pedido de folga pelo sistema (folga agora é combinada direto com o chefe).
drop function if exists public.barber_request_block(timestamp,timestamp,text);
drop function if exists public.admin_decide_block(uuid,boolean);
drop table if exists public.block_requests;
commit;
notify pgrst,'reload schema';
