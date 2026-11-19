# WhatsApp oficial: lembrete automático e robô de agendamento (em standby)

Data: 19/11/2026. Branch: `whatsapp-oficial` (cópia separada em `orca/workspaces/Agendamento-Barbearia/whatsapp-oficial`, criada a partir da `main` depois do merge do #16). Agente: Claude.

## Feito
- `database/whatsapp-oficial.sql`: configuração `whatsapp_settings` (desligada), estado das conversas `wa_sessions`, `bot_book` (mesmas travas do site: horário livre, 3 futuros e 10 em 24 h por celular) e `whatsapp_due_reminders` (reservas de amanhã sem lembrete, a partir da hora escolhida). `message_log` ganhou `channel` e `provider_id`. Entrou nos instaladores (regerados) e no LEIA-ME (10c).
- `supabase/functions/whatsapp/`: `index.ts` (webhook com verificação da assinatura da Meta, rota `/lembretes` protegida por `CRON_SECRET`) e `bot.js` (conversa: menu → serviço → barbeiro/sem preferência → dia → horário → nome → confirmar; "Meus horários"; "menu" recomeça; mensagem de lembrete com 5 variáveis).
- Painel (Campanhas → "WhatsApp oficial (automático)"): Phone Number ID, modelo, idioma, versão da API, hora de envio, chaves de lembrete, robô e ligar; resultado da última execução; texto do modelo para cadastrar na Meta; link do passo a passo.
- `database/WHATSAPP-OFICIAL.md`: passo a passo (Meta, segredos, deploy, pg_cron a cada 5 min, webhook). Manual e FAQ atualizados.

## Verificação
- `node qa/whatsapp-bot.mjs`: 11 de 11. `qa/demo-audit.cjs`: 52 de 52. `qa/static-audit.cjs`: sem erros. `index.ts`: sintaxe conferida com o Node.
- Painel no navegador Orca em 1366 px e 390 px (sem rolagem lateral).

## Não verificado
- A função não foi executada de ponta a ponta: Deno e Supabase CLI não estão instalados, e não há conta Meta. A chamada à Meta segue o formato da API Cloud (`/messages` com `template` e `interactive`), mas só será provada quando a barbearia tiver número e token.
- `whatsapp-oficial.sql` e `crescimento.sql` não foram rodados em nenhum Supabase real.
- Nada foi commitado nem publicado.
