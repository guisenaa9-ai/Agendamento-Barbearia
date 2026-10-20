# Instalar para uma barbearia nova (modelo A: uma cópia por cliente)

## 1. Supabase (projeto novo para o cliente)
Banco que já está em uso: rode só `atualizar-banco-existente.sql` (todas as atualizações, na ordem).

Atalho: rode só `instalar-tudo.sql` (itens 1 a 12 abaixo juntos, gerado por `gerar-instalar-tudo.sh`).

No SQL Editor, execute nesta ordem (todos podem ser repetidos sem problema):

1. `00-base.sql` – tabelas, regras de acesso, funções principais e armazenamento de fotos
1b. `equipe-atendente.sql` – perfil de atendente (Agenda, Atendimentos e Caixa); rode logo depois do 00-base
2. `gestao-profissional.sql` – caixa, faltas, bloqueios, clientes presenciais
3. `horarios-loja.sql` – horário de funcionamento por dia e por barbeiro
4. `sem-preferencia-cliente.sql` – reserva "sem preferência" e limite de reservas por cliente
5. `cancelamento-com-motivo.sql`
6. `servicos-visuais.sql`
7. `painel-kryon.sql` – troque o e-mail do monitor Kryon dentro do arquivo antes de rodar
8. `sem-horario-duplicado.sql` – impede duas reservas no mesmo horário para o mesmo barbeiro
9. `barbeiro-fidelidade.sql` – área do barbeiro e programa de fidelidade (desligado até o chefe ativar)
10. `barbeiro-avisos.sql` – barbeiro vê avisos de novos agendamentos e cancelamentos
11. `lgpd.sql` – permite ao cliente excluir a própria conta (exigência da LGPD)
12. `seguranca-permissoes.sql` – tira de visitantes e clientes as funções que são só do chefe ou de uso interno
13. `seguranca-2fa.sql` – exige o código do celular (verificação em duas etapas) para o chefe e a Kryon. Rode **depois** que o chefe já entrou uma vez e ativou o código pelo QR Code

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
- `contact`: WhatsApp ou e-mail da barbearia para dúvidas sobre dados pessoais (aparece em Termos e privacidade)

E troque o nome da barbearia em `manifest.webmanifest` e `painel.webmanifest` (nome do app instalado no celular).

Publique no GitHub Pages (Settings → Pages → branch e pasta raiz).

## 3. No painel do chefe
Agenda → Horário de funcionamento; Serviços; Barbeiros (foto, especialidade e apresentação).

## Atualizar um cliente
Copie todos os arquivos deste repositório, menos o `config.js` dele, e rode no Supabase dele os `.sql` novos ou alterados.

## Demonstração para mostrar a clientes
1. Crie um projeto Supabase só para a demo e siga o passo 1 inteiro (incluindo criar o chefe em `admins`).
2. Rode `demo-dados.sql`: cria a barbearia fictícia com 3 barbeiros, 6 serviços, 30 dias de histórico
   (atendimentos pagos, faltas, cancelamentos), 7 dias de agenda, uma folga e o caixa da semana.
   O script recusa rodar em banco que já tenha reservas.
3. Publique uma cópia do site com o `config.js` apontando para o projeto da demo (`shopName` pode ser o nome fictício).
