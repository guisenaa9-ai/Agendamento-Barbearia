-- Repetível. Mantém reservas e permite escolher qualquer barbeiro disponível.
begin;
alter table public.bookings add column if not exists no_preference boolean not null default false;
create or replace function public.available_slots(p_date date,p_barber uuid,p_service uuid)
returns table(slot text) language sql stable security definer set search_path='' as $$
select to_char(t,'HH24:MI') from public.services s
cross join generate_series(p_date+time '09:00',p_date+time '18:30',interval '30 minutes') t
where s.id=p_service and s.active
and p_date between (now() at time zone 'America/Manaus')::date and (now() at time zone 'America/Manaus')::date+60
and t>now() at time zone 'America/Manaus'
and t+make_interval(mins=>s.duration)<=p_date+time '19:00'
and exists (
 select 1 from public.barbers b where b.active and (p_barber is null or b.id=p_barber)
 and not exists(select 1 from public.bookings r where r.barber_id=b.id and r.status='confirmed'
 and tsrange(r.starts_at,r.ends_at,'[)') && tsrange(t,t+make_interval(mins=>s.duration),'[)'))
) order by t;
$$;
create or replace function public.available_options(p_date date,p_service uuid)
returns table(slot text,barbers text[]) language sql stable security definer set search_path='' as $$
select a.slot,array_agg(b.name order by b.name,b.id) from public.barbers b
cross join lateral public.available_slots(p_date,b.id,p_service) a
where b.active group by a.slot order by a.slot;
$$;
create or replace function public.customer_book(p_date date,p_time text,p_barber uuid,p_service uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare profile public.customer_profiles%rowtype; result uuid; candidate uuid;
begin
 if auth.uid() is null then raise exception 'Entre na sua conta para agendar.';end if;
 select * into profile from public.customer_profiles where id=auth.uid();
 if not found or profile.name is null or profile.phone is null then raise exception 'Complete nome e celular na sua conta antes de agendar.';end if;
 if p_barber is null then
 select b.id into candidate from public.barbers b
 where b.active and exists(select 1 from public.available_slots(p_date,b.id,p_service) a where a.slot=p_time)
 order by (select count(*) from public.bookings r where r.barber_id=b.id and r.status='confirmed' and r.starts_at::date=p_date),b.name,b.id
 limit 1;
 if candidate is null then raise exception 'Nenhum barbeiro disponível para esse horário. Atualize e escolha outro.';end if;
 else candidate:=p_barber;
 end if;
 result:=public.book_appointment(p_date,p_time,candidate,p_service,profile.name,profile.phone);
 update public.bookings set customer_id=auth.uid(),no_preference=(p_barber is null) where id=result;
 return result;
end;$$;
revoke all on function public.available_options(date,uuid) from public;
grant execute on function public.available_slots(date,uuid,uuid),public.available_options(date,uuid) to anon,authenticated;
revoke all on function public.customer_book(date,text,uuid,uuid) from public,anon;
grant execute on function public.customer_book(date,text,uuid,uuid) to authenticated;

create or replace function public.customer_book_with_assignment(p_date date,p_time text,p_service uuid)
returns table(booking_id uuid,barber_name text) language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 result:=public.customer_book(p_date,p_time,null,p_service);
 return query select r.id,r.barber_name from public.bookings r where r.id=result and r.customer_id=auth.uid();
end;$$;
revoke all on function public.customer_book_with_assignment(date,text,uuid) from public,anon;
grant execute on function public.customer_book_with_assignment(date,text,uuid) to authenticated;
commit;
notify pgrst,'reload schema';
