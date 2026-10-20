# Instalar para uma barbearia nova (modelo A: uma cópia por cliente)

## 1. Supabase (projeto novo para o cliente)
No SQL Editor, execute nesta ordem (todos podem ser repetidos sem problema):

1. `00-base.sql` – tabelas e funções principais (reservas, barbeiros, serviços, login do chefe)
2. `gestao-profissional.sql` – caixa, faltas, bloqueios, clientes presenciais
3. `horarios-loja.sql` – horário de funcionamento por dia e por barbeiro
4. `sem-preferencia-cliente.sql` – reserva "sem preferência" e limite de reservas por cliente
5. `cancelamento-com-motivo.sql`
6. `servicos-visuais.sql`
7. `painel-kryon.sql` – troque o e-mail do monitor Kryon dentro do arquivo antes de rodar
8. `sem-horario-duplicado.sql` – impede duas reservas no mesmo horário para o mesmo barbeiro

Depois, crie o usuário do chefe em Authentication → Users e torne-o administrador:
```sql
insert into public.admins(user_id) select id from auth.users where email='EMAIL_DO_CHEFE';
```

Em Authentication:
- URL Configuration: Site URL = endereço do site; Redirect URLs = endereço + `/conta.html`
- Providers → Email: senha mínima 8
- Attack Protection: Captcha (Turnstile) com a Secret Key do cliente — só depois do site estar no ar com a Site Key

## 2. Site (cópia deste repositório)
Só o `config.js` muda de um cliente para outro:
- `url` e `publicKey`: do projeto Supabase do cliente (Settings → API; nunca a service_role)
- `captchaSiteKey`: Site Key do Turnstile com o hostname do cliente
- `shopName`: nome sem a palavra "Barbearia"

Publique no GitHub Pages (Settings → Pages → branch e pasta raiz).

## 3. No painel do chefe
Agenda → Horário de funcionamento; Serviços; Barbeiros (foto, especialidade e apresentação).

## Atualizar um cliente
Copie todos os arquivos deste repositório, menos o `config.js` dele, e rode no Supabase dele os `.sql` novos ou alterados.
