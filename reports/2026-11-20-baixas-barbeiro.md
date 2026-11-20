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
