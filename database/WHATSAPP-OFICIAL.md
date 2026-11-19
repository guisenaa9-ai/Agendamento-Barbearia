# WhatsApp oficial: lembrete automático e robô de agendamento

Tudo já está no sistema e fica **desligado** até estes passos serem feitos. Enquanto isso, os lembretes de 1 toque da Agenda continuam funcionando.

**Custo:** a Meta cobra o lembrete (mensagem de "utilidade") por mensagem, por volta de US$ 0,007 cada no Brasil. 20 lembretes por dia dão cerca de US$ 4 a 5 por mês. As conversas que o cliente começa (o robô de agendamento) não são cobradas. Confira a tabela atual em https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing

## 1. Meta (feito pela barbearia)
1. Criar a conta empresarial em https://business.facebook.com e um app do tipo "Empresa" em https://developers.facebook.com com o produto **WhatsApp**.
2. Adicionar o **número da barbearia** à API. Esse número **não pode ficar ao mesmo tempo no app WhatsApp do celular**: use um número novo ou migre o atual.
3. Anotar o **Phone Number ID** (WhatsApp → Configuração da API).
4. Criar um **usuário do sistema** (Configurações da empresa → Usuários do sistema), dar acesso ao app e gerar um **token permanente** com as permissões `whatsapp_business_messaging` e `whatsapp_business_management`.
5. Anotar o **App Secret** (Configurações do app → Básico).
6. Criar o modelo de mensagem (WhatsApp → Modelos de mensagem):
   - Categoria: **Utilidade**. Nome: `lembrete_horario`. Idioma: Português (BR), `pt_BR`.
   - Corpo (o mesmo texto aparece para copiar em Campanhas → WhatsApp oficial):
     `Olá, {{1}}! Lembrete da Barbearia Daniel Silva: seu horário é {{2}} às {{3}} (horário de Manaus), com {{4}}, para {{5}}. Se precisar alterar ou cancelar, responda esta mensagem.`
   - Exemplos para a aprovação: Carlos · Sex, 20/11 · 09:40 · Daniel Silva · Corte masculino.

## 2. Supabase
1. No SQL Editor, rodar `whatsapp-oficial.sql` (depois de `crescimento.sql`). Ele já entra em `instalar-tudo.sql` e `atualizar-banco-existente.sql`.
2. Instalar o Supabase CLI e, na pasta do projeto, gravar os segredos (troque os valores):
   ```
   supabase secrets set WHATSAPP_TOKEN=<token permanente> WHATSAPP_APP_SECRET=<app secret> WHATSAPP_VERIFY_TOKEN=<uma senha que você inventa> CRON_SECRET=<outra senha longa> SHOP_NAME="Daniel Silva" SITE_URL=https://<endereço do site>
   ```
3. Publicar a função (o `--no-verify-jwt` é necessário porque a Meta não manda login; a função confere a assinatura da Meta):
   ```
   supabase functions deploy whatsapp --no-verify-jwt
   ```
4. Ligar as extensões `pg_cron` e `pg_net` (Database → Extensions) e criar a tarefa de 5 minutos no SQL Editor:
   ```sql
   select cron.schedule('lembretes-whatsapp','*/5 * * * *',$$
     select net.http_post(
       url:='https://<ref-do-projeto>.supabase.co/functions/v1/whatsapp/lembretes',
       headers:=jsonb_build_object('Authorization','Bearer <CRON_SECRET>','Content-Type','application/json'),
       body:='{}'::jsonb)$$);
   ```
   Para parar: `select cron.unschedule('lembretes-whatsapp');`

## 3. Meta → webhook do robô
WhatsApp → Configuração → Webhook:
- URL de retorno: `https://<ref-do-projeto>.supabase.co/functions/v1/whatsapp`
- Token de verificação: o mesmo `WHATSAPP_VERIFY_TOKEN`
- Assinar o campo **messages**.

## 4. Painel do chefe
Campanhas → **WhatsApp oficial (automático)**: preencher o Phone Number ID, conferir o nome do modelo e a hora de envio, marcar "Ligar o WhatsApp oficial" e salvar.

## Como funciona
- **Lembrete:** a cada 5 minutos, a partir da hora escolhida (18:00 se nada for mudado), a função manda o modelo para as reservas de amanhã que ainda não receberam lembrete, até 20 por vez. Cada envio fica marcado como "✓ Enviado" na Agenda, igual ao manual. O resultado da última execução aparece no painel.
- **Robô:** o cliente manda "oi" para o número. Ele escolhe serviço, barbeiro (ou "Sem preferência"), dia e horário em listas do WhatsApp, informa o nome se for a primeira vez e confirma. A reserva entra na agenda com as mesmas regras do site: só horários livres, no máximo 3 horários futuros e 10 reservas em 24 horas por celular. "Meus horários" mostra as próximas reservas com o código. "menu" recomeça.
- **Segurança:** o token fica só nos segredos da função, nunca no painel nem no banco. Mensagens sem a assinatura da Meta são recusadas, e a rota de lembretes exige o `CRON_SECRET`.
