# Calendário de agendamento e faixa de aviso

Data: 20/11/2026. Branch: `calendario-faixa`. Agente: Claude.

## Pedido
Usar o visual dos componentes Banner (faixa com brilho) e Calendar 03 (calendário + horários), mantendo as cores da barbearia. O projeto é HTML/JS puro (sem React/Tailwind/shadcn), então os componentes foram reproduzidos sem instalar nada.

## Feito
- `calendar-picker.js/.css`: calendário do mês + lista de horários livres, no agendamento do cliente (`agendar.html`) e na Nova reserva do balcão (`admin.html`). O input de data e o select de horário continuam sendo a fonte do valor (booking.js/admin.js sem mudança). No celular, horários em 3 colunas abaixo do calendário.
- `aviso-site.js` + `database/aviso-site.sql`: faixa verde com brilho dourado no topo da página inicial e do agendamento; o chefe escreve em Campanhas → "Aviso no site" (sub-aba nova, com prévia). Fechar no X vale até o texto mudar. Respeita "reduzir movimento".
- SQL aplicado no Supabase real: coluna `shop_settings.announcement` e função pública `site_announcement()` (visitante lê só o texto). Aviso começa vazio.
- Manual, LEIA-ME (10e) e instaladores.

## Verificação
- 60/60, static OK.
- Navegador (demo): cliente escolheu serviço, Daniel, 24/11, 11:00 e confirmou (reserva criada); balcão (atendente) Nova reserva 25/11 09:40; editor do aviso salvou e a faixa mudou no site; X fecha e continua fechada após recarregar. 1366 e 390 px sem rolagem lateral.

## Não verificado / limites
- O calendário não apaga sozinho os dias em que a barbearia fecha (domingo etc.): ao tocar, aparece "Sem horários livres neste dia".
- A remarcação em "Meus agendamentos" (index.html) continua com o campo de data antigo.
