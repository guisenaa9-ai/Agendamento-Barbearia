# Baixas na comissão e acerto do barbeiro

Data: 20/11/2026. Branch: `baixas-barbeiro` (cópia separada em `orca/workspaces/Agendamento-Barbearia/baixas-barbeiro`, a partir da `main` com o #17). Agente: Claude.

## Antes disso, nesta rodada
- `crescimento.sql` e `whatsapp-oficial.sql` aplicados no Supabase real (`nqshsvhrgrkzpivuhtxa`), que estava pausado e foi reativado com autorização. O `whatsapp-oficial.sql` falhou na 1ª tentativa (regex `{1,512}` acima do limite do PostgreSQL) e passou com a regra equivalente; o arquivo do repositório foi corrigido neste branch.
- Conferido: 7 tabelas novas com RLS, WhatsApp desligado, 17 reservas intactas, `bot_book` fechado para visitantes.

## Feito
- `database/baixas-barbeiro.sql`: `barber_deductions` (vale, produto do estoque, compra parcelada, outra) e `barber_settlements`; funções `admin_add_deduction`, `admin_delete_deduction`, `admin_barber_settlement`, `admin_settle`, `my_settlement`. Vale e pagamento em dinheiro saem do Caixa; produto baixa o estoque; compra vira parcelas mensais; baixas acima da comissão ficam para o próximo acerto; acerto pago trava as baixas e impede período sobreposto.
- Financeiro: bloco "Acerto do barbeiro" (escolha do barbeiro, período do relatório, baixas, A pagar, "+ Lançar baixa", "Marcar como pago") e colunas Baixas / A pagar no relatório.
- Área do barbeiro: bloco "Acerto do mês" com as baixas e o valor a receber.
- Demo: `demo-baixas.js` (mesmas regras, com vale, pomada e máquina 3x de exemplo); `demo-mock.js` só ganhou o gancho `window.DemoMock`.
- Manual (Financeiro e Área do barbeiro), instaladores e LEIA-ME (10d).

## Verificação
- `node qa/demo-audit.cjs`: 60 de 60 (8 novos). `node qa/static-audit.cjs`: sem erros. `node qa/whatsapp-bot.mjs`: 11 de 11.
- Navegador Orca, 1366 px e 390 px: lançar compra 4x, valor A pagar (505 → 455), marcar pago em dinheiro (saída no Caixa, "Excluir" some, coluna com ✓), Área do barbeiro.

## Não verificado
- `baixas-barbeiro.sql` não foi rodado em PostgreSQL nenhum (só a versão do simulador foi testada).
- Nada foi commitado nem publicado.

## Rodada 2: aba própria "Acerto dos barbeiros" (PR seguinte)
- O usuário não achou o lançamento no fim do Financeiro. Escolheu "Aba própria" e o nome "Despesa do barbeiro".
- Nova aba no menu do chefe: mês do acerto, "+ Lançar despesa" (com escolha do barbeiro), total a pagar no mês, um cartão por barbeiro (comissão, despesas, a pagar ou ✓ pago) e o detalhe com "Excluir" e "Marcar como pago".
- Financeiro ganhou o botão "+ Despesa do barbeiro" (abre a aba) e as colunas passaram a "Despesas" / "A pagar".
- "Baixa" virou "despesa" na tela, no manual (seção nova "Acerto dos barbeiros"), na Área do barbeiro e nas mensagens do banco (admin_add_deduction e admin_delete_deduction reaplicadas no Supabase real).
- Corrigido: página aberta direto em #acerto não carregava os cartões (login terminava antes do script).
- Verificado: 60/60, static OK; navegador 1366 e 390 px (lançar compra 4x para o Lucas, pagar em dinheiro, saída no Caixa). Prints: acerto-aba-desktop.png, acerto-aba-mobile.png, acerto-despesa-mobile.png.

## Rodada 3: Acerto vira sub-aba do Financeiro
- Pedido do usuário: o Acerto fica dentro do Financeiro. Saiu do menu lateral; o Financeiro tem as sub-abas "Relatório" e "Acerto dos barbeiros". O botão "+ Despesa do barbeiro" do Relatório abre a sub-aba com o formulário.
- Verificado: 60/60, static OK; navegador 1366 e 390 px (sub-abas, cartões, atalho, sem rolagem lateral). Prints: acerto-subaba-desktop.png, acerto-subaba-mobile.png.

## Rodada 4: sub-abas em todas as abas e Financeiro com 4 sub-abas
- Pedido: sub-abas no estilo da imagem enviada (barra clara, ativa escura) em todos os tópicos; tirar "Acerto dos barbeiros" e deixar tudo no Financeiro.
- `subtabs.js` monta a barra em cada aba e mostra só os blocos da sub-aba escolhida (MutationObserver reaplica quando growth.js/whatsapp-api.js recriam blocos):
  Dashboard (Visão geral | Análise do período), Agenda (Agenda | Nova reserva | Bloqueios e horários, esta só chefe), Financeiro (Visão geral | Comissões | Despesas do barbeiro | Detalhamento), Caixa (Hoje | Novo lançamento | Movimentações), Serviços (Serviços | Produtos | Clube de assinatura | Fidelidade), Barbeiros (Equipe | Metas e Pix | Atendentes), Campanhas (Públicos | Fila de envio | WhatsApp oficial).
- Financeiro: Comissões = tabela do mês (comissão, despesas, a pagar, Pagar / ✓ Pago) com detalhe e "Marcar como pago"; Despesas do barbeiro = lista do mês com filtro por barbeiro, "+ Lançar despesa" e "Excluir". Colunas extras do relatório saíram (ficam em Comissões). Impressão continua com relatório + detalhamento.
- Verificado: 60/60, static OK; navegador: todas as sub-abas de todas as abas clicadas (blocos certos em cada uma), despesa 4x para o Lucas + pagamento em dinheiro, 1366 e 390 px sem rolagem lateral. Prints subabas-*.png.
