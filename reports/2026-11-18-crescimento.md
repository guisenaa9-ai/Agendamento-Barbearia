# Crescimento: lembretes, campanhas, produtos, clube de assinatura e área do barbeiro

Data: 18/11/2026. Branch: `demo-simulador-e-manual`. Agente: Claude.

## O que foi feito
Escolhas do usuário: lembrete por "fila de 1 toque" (sem API paga de WhatsApp), sinal por Pix adiado, Campanhas em cartões + fila, Área do barbeiro com painel de ganhos no topo.

| Área | Onde | O que faz |
|---|---|---|
| Lembretes de horário | Agenda (chefe e atendente) | Lista o resto de hoje e amanhã; "Enviar lembrete" abre o WhatsApp com a mensagem pronta e marca ✓ Enviado. |
| Campanhas | Aba nova, só chefe | Públicos Sumidos (N dias), Fiéis (5+), Assinante atrasado, Avaliação no Google (7 dias); mensagem editável com {nome} etc.; fila com envio de 1 toque e "Não enviar mais" (LGPD). |
| Produtos e estoque | Serviços, só chefe | Cadastro, preço, entrada de estoque, ativar/desativar, aviso de "acabando"; na ficha, "+ Produto"; baixa do estoque ao concluir. |
| Clube de assinatura | Serviços, só chefe | Planos (mensalidade, limite por mês), assinantes, registrar mensalidade (entra no Caixa e adianta a validade), cancelar. Na ficha, "Usar assinatura" zera o serviço e a forma "Assinatura". Assinatura não conta ponto de fidelidade. |
| Metas e gorjetas | Barbeiros, só chefe | Meta mensal e chave Pix de cada barbeiro. |
| Área do barbeiro | barbeiro.html | Cartão do mês: faturado x meta, comissão, previsão com a agenda; nota média e últimos comentários. |
| Avaliação e gorjeta | Minha conta (cliente) | Avaliar atendimento concluído (1 a 5 + comentário); depois, "Copiar chave Pix" do barbeiro. |
| Manual | manual.html e aba Manual | Seção Campanhas e passos novos em Agenda, Atendimentos, Serviços, Barbeiros, Área do barbeiro, Minhas reservas e FAQ. |

## Arquivos
- Novos: `database/crescimento.sql`, `growth.js/.css`, `barber-growth.js/.css`, `review.js/.css`.
- Ajustes pequenos (trocas exatas): `attendance.js` (produto na ficha + ganchos), `attendance-model.js` (forma Assinatura), `staff-tabs.js` (aba Campanhas), `admin.html`, `account.js`, `index.html`, `conta.html`, `barbeiro.html`, `demo-mock.js`, manual.
- Banco: `crescimento.sql` entrou em `instalar-tudo.sql` e `atualizar-banco-existente.sql` (regerados) e no LEIA-ME (10b). Substitui `save_attendance` e `loyalty_status`.

## Verificação
- `node qa/demo-audit.cjs`: 52 de 52 (11 novos). `node qa/static-audit.cjs`: sem erros. `node qa/balcao.cjs` (do Codex): OK.
- Navegador Orca, 1366 px e 390 px: Campanhas (envio registrado, mensagens montadas), lembretes, produtos, clube, metas, ficha (assinatura + pomada + Pix, estoque 12→11), área do barbeiro, avaliação e gorjeta, manual. Atendente não vê Campanhas, produtos nem metas. Prints em `screenshots/`.

## Atenção
- `crescimento.sql` não foi rodado em nenhum Supabase real. Rodar no banco do cliente antes de publicar.
- Um agente Codex trabalhou ao mesmo tempo nesta pasta (Balcão do dia da atendente). Nada dele foi desfeito; o botão "Atendimentos" do menu do chefe perdeu o ícone depois da mudança dele (não é deste trabalho).
- Nada foi commitado nem publicado.
