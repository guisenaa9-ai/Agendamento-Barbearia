-- Dados FICTÍCIOS para um projeto Supabase de DEMONSTRAÇÃO (nunca rode no banco de um cliente).
-- Pré-requisitos: todos os arquivos do LEIA-ME já executados e o usuário do chefe já criado em admins.
-- Gera barbeiros, serviços, 30 dias de histórico e 7 dias de agenda, relativos à data de hoje.
begin;
do $$
declare
 hoje date:=(now() at time zone 'America/Manaus')::date;
 agora timestamp:=now() at time zone 'America/Manaus';
 chefe uuid;
 nomes text[]:=array['Lucas Almeida','Pedro Henrique','Mateus Oliveira','Gabriel Souza','Rafael Lima','João Victor','Thiago Santos','Bruno Ferreira','Felipe Rocha','André Costa','Vinícius Melo','Caio Martins','Diego Ribeiro','Gustavo Araújo','Leonardo Pinto','Marcelo Dias','Rodrigo Nunes','Samuel Barros','Igor Teixeira','Daniel Moura'];
 metodos text[]:=array['pix','pix','pix','cash','credit','debit'];
 b record; s record; d date; h int; inicio timestamp; sorte float; cliente int; reserva uuid;
begin
 if to_regclass('public.business_hours') is null or to_regclass('public.kryon_admins') is null then
  raise exception 'Estrutura incompleta: rode antes, na ordem, os arquivos do LEIA-ME.md (00-base.sql até seguranca-2fa.sql).';
 end if;
 chefe:=(select user_id from public.admins limit 1);
 if exists(select 1 from public.bookings) then
  raise exception 'Este banco já tem reservas. Rode a demonstração só num projeto novo e vazio.';
 end if;
 perform setseed(0.42); -- mesma demonstração toda vez

 insert into public.barbers(name,specialty,bio) values
  ('Rafael Andrade','Degradê e desenhos','Especialista em degradê navalhado e desenhos. Atende com hora marcada e capricha no acabamento.'),
  ('Marcos Vieira','Corte clássico e barba','Mais de 10 anos de experiência com cortes sociais, barba modelada e toalha quente.'),
  ('Júlia Castro','Cortes modernos e coloração','Cortes texturizados, platinado e luzes. Conversa sobre o estilo antes de começar.');
 insert into public.services(name,duration,price,description) values
  ('Corte',30,40,'Corte na tesoura ou máquina, com lavagem e finalização.'),
  ('Barba',30,30,'Barba modelada com navalha e toalha quente.'),
  ('Corte + Barba',60,65,'O combo completo, com desconto.'),
  ('Pezinho',15,15,'Acabamento do contorno entre um corte e outro.'),
  ('Sobrancelha',15,15,'Limpeza e alinhamento na navalha.'),
  ('Hidratação',45,35,'Tratamento para cabelo e barba ressecados.');

 -- Domingo fechado; sábado até as 17h. O resto segue o padrão de horarios-loja.sql (9h às 19h).
 delete from public.business_hours where barber_id is null and weekday=0;
 update public.business_hours set closes_at='17:00' where barber_id is null and weekday=6;

 for d in select generate_series(hoje-30,hoje+7,interval '1 day')::date loop
  continue when extract(dow from d)=0;
  for b in select * from public.barbers loop
   for h in 9..(case when extract(dow from d)=6 then 16 else 18 end) loop
    inicio:=d+make_time(h,0,0);
    continue when random()>(case when inicio<agora then 0.55 else 0.35 end);
    select * into s from public.services order by random() limit 1;
    cliente:=1+floor(random()*array_length(nomes,1))::int;
    sorte:=random();
    insert into public.bookings(customer,phone,service_id,barber_id,service_name,barber_name,price,starts_at,ends_at,no_preference,created_at)
    values(nomes[cliente],'929'||lpad((90000000+cliente)::text,8,'0'),s.id,b.id,s.name,b.name,s.price,inicio,inicio+make_interval(mins=>s.duration),
     random()<0.2,(inicio-make_interval(days=>1+floor(random()*5)::int)) at time zone 'America/Manaus')
    returning id into reserva;
    if inicio<agora then
     if sorte<0.06 then
      update public.bookings set status='cancelled',cancellation_source='client',cancelled_at=now() where id=reserva;
     elsif sorte<0.10 then
      update public.bookings set no_show=true,no_show_at=now() where id=reserva;
     else
      insert into public.attendances(booking_id,arrived_at,finished_at,base_price,total,payment_method,paid,paid_at)
      values(reserva,inicio at time zone 'America/Manaus',(inicio+make_interval(mins=>s.duration)) at time zone 'America/Manaus',
       s.price,s.price,metodos[1+floor(random()*array_length(metodos,1))::int],true,(inicio+make_interval(mins=>s.duration)) at time zone 'America/Manaus');
      update public.bookings set attendance_state='completed' where id=reserva;
     end if;
    end if;
   end loop;
  end loop;
 end loop;

 delete from public.bookings where barber_name='Júlia Castro' and starts_at::date=hoje+5; -- dia da folga fica livre
 insert into public.schedule_blocks(barber_id,starts_at,ends_at,reason)
 select id,hoje+5+time '09:00',hoje+5+time '19:00','Folga' from public.barbers where name='Júlia Castro';
 insert into public.customer_directory(name,phone) values('Seu Raimundo','92991110001'),('Carlos Eduardo','92991110002');

 if chefe is null then
  raise notice 'Sem usuário em admins: o caixa de demonstração não foi criado.';
 else
  insert into public.cash_sessions(business_date,opening_amount,closing_amount,closed_at,created_by)
  select g::date,150,null,null,chefe from generate_series(hoje-6,hoje,interval '1 day') g;
  insert into public.cash_movements(business_date,kind,category,description,amount,payment_method,created_by) values
   (hoje-5,'expense','Produtos','Pomada e lâminas',180,'pix',chefe),
   (hoje-3,'expense','Contas','Energia',320,'pix',chefe),
   (hoje-1,'withdrawal','Retirada','Troco para o banco',100,'cash',chefe),
   (hoje,'income','Venda','Pomada modeladora',45,'cash',chefe);
 end if;
end $$;
commit;
