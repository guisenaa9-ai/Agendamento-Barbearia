# Dashboard: Visão geral no modelo da imagem enviada

Data: 20/11/2026. Branch: `dashboard-visao`. Agente: Claude.

## Feito
- `dashboard-model.js` (cálculo, sem DOM) + `qa/dashboard-model.cjs` (testes: datas de Manaus, cliente único por celular, cancelados+faltas, comparação de períodos).
- `dashboard-overview.js`: no topo do Dashboard → Visão geral: título, seletor 7D/30D/90D/12M, 4 cartões (Faturamento, Clientes atendidos, Ticket médio, Cancelamentos e faltas) com variação vs período anterior e minigráfico, e o gráfico de faturamento (linha dourada x tracejada do anterior) com botão de tabela. Cores da barbearia; gráfico desenhado na largura real (legível no celular).
- Dados: reservas + atendimentos pagos (mesma fonte do Financeiro), sem mudança no banco.
- Manual atualizado.

## Verificação
- 60/60, static OK, dashboard-model OK.
- Navegador (demo): 7D, 30D, 12M, tabela (30 linhas em 30D), 1366 e 390 px sem rolagem lateral.

## Limites
- Cards "Dia da agenda" e ranking continuam abaixo (são do dia escolhido no filtro do topo).
- Sem dica flutuante ao passar o mouse no gráfico (os valores aparecem no title dos pontos e na tabela).
