# Verificação da demonstração — Barbearia Daniel Silva

Data local: 17/11/2026 (America/Manaus). Branch: `claude/project-thread-2v8oac`, PR #13.

## Parecer

**A demonstração ainda não está pronta para uma apresentação interativa de todas as funcionalidades.** As telas carregam, mas várias ações exibem sucesso sem persistir os dados fictícios, e o fluxo de recepção/pagamento está bloqueado.

O escopo foi confirmado pelo usuário: **demonstração com dados fictícios**. Nenhuma reserva real, mensagem, pagamento real ou configuração do Supabase foi alterada. Não foi feito deploy, merge ou alteração de código do produto. Foram adicionados testes de auditoria e evidências locais.

## Método e resultado

- 41 cenários isolados executados contra o `demo-mock.js` original: **12 passaram e 29 falharam**. São verificações de contratos e comportamentos, não 29 defeitos independentes nem uma porcentagem de qualidade do produto.
- 31 arquivos JavaScript analisados: nenhuma falha de sintaxe.
- 10 páginas HTML e 138 referências locais examinadas: nenhum destino local ausente.
- Navegação no navegador Orca, reprodução de remarcação, bloqueio da ficha de atendimento, serviço sem default ativo, fechamento do caixa e erro de login da equipe; criação de reserva pela interface e capturas em 1366 × 900 e 390 × 844.
- Sete abas do chefe abriram com conteúdo. No perfil atendente, somente Agenda, Caixa e Atendimentos ficaram disponíveis. Evidências em `browser-tabs.json` e `browser-reproductions.json`.
- Testes isolados usam memória nova em cada cenário e impedem requisições externas. Servem para diagnosticar o simulador; não validam as funções SQL em produção.

Reexecutar: `node qa/demo-audit.cjs` e `node qa/static-audit.cjs`. O primeiro encerra com código 1 enquanto houver falhas. Resultados detalhados: `demo-audit-results.json` e `static-audit-results.json`.

## Bloqueios prioritários

| Prioridade | Fluxo | Evidência e impacto |
|---|---|---|
| P1 | Chegada → pagamento | `mark_arrival` muda o status, mas não cria a ficha em `attendances`. Na interface, “Registrar procedimentos e pagamento” mostra “Atualize a lista para carregar o atendimento” e não abre o editor. As fichas iniciais também não têm `base_price` e `version`. |
| P1 | Salvar/concluir atendimento | A tela envia `p_finish`, `p_method`, extras e desconto; o simulador lê `p_complete`, `p_payment_method` e `p_total`. Salvar parcialmente conclui o atendimento, extras/desconto não entram no total e dinheiro vira Pix. |
| P1 | Remarcação | Reprodução no navegador: reserva de 26/11 às 15:30 alterada para 09:40; aparece sucesso, mas continua às 15:30. `customer_reschedule` é uma função vazia. |
| P1 | Disponibilidade | Lista fixa de 10 horários, sem considerar reservas, domingo fechado, expediente, bloqueios ou duração. Reservar não retira o horário; fechar a agenda também não. |
| P1 | Caixa | POST com `on_conflict=business_date` insere outra linha em vez de atualizar. O fechamento lê a primeira linha e continua com dados antigos. |
| P1 | Equipe | Salvar barbeiro, comissão, login vinculado e atendente não têm implementação no mock. O despachante retorna sucesso/null para operações desconhecidas. |
| P1 | Login da equipe após sair | O login inicial da demo é automático. Ao usar o formulário, `BarberAPI.mfa` espera `factor.totp.qr_code`, mas a resposta fictícia é uma sessão genérica. Não há suporte ao fluxo MFA da tela. |

## Cobertura por funcionalidade

| Área | Resultado | Observações |
|---|---|---|
| Catálogo de serviços/barbeiros | Parcial | Dados iniciais carregam e filtros de ativos funcionam. |
| Login do cliente | Parcial | Aceita e-mail/senha fictícios e retorna a sessão fixa; não representa autenticação real. |
| Cadastro do cliente | Falha | Nome/telefone/e-mail enviados não criam perfil; continua Guilherme. |
| Recuperação/troca de senha | Simulação incompleta | Endpoint genérico responde sucesso, sem e-mail, alteração de credencial ou ciclo completo. Não validado como autenticação real. |
| Agendar com barbeiro específico | Parcial | Cria reserva e mostra confirmação na interface. Fim igual ao início; não verifica conflito e aceita até data ISO impossível em chamada direta. |
| Agendar sem preferência | Parcial | Sempre atribui Lucas e não grava `no_preference`; não demonstra distribuição real nem os indicadores do painel. |
| Minhas reservas | Parcial | Lista e atualiza. Reservas fictícias têm duração zero; algumas ações dependem de RPCs vazias. |
| Cancelar pelo cliente | Passou no mock | Status muda para cancelado. Prazo de uma hora não é validado pelo simulador. |
| Cancelar pela loja | Parcial | Cancela, mas guarda origem de cliente e perde motivo. O botão também prepara um link externo de WhatsApp. |
| Alterar reserva | Falha | Sucesso sem alteração. |
| Recuperar reserva pelo código | Falha | Formulário exige UUID; códigos `demo-new-*` e `demo-me-*` não passam. `customer_claim` é vazio. |
| Dados do cliente | Passou no mock | Alteração de nome/telefone no perfil persiste. |
| Excluir conta | Falha | Função vazia; perfil fictício permanece. |
| Fidelidade | Falha | Retorna sempre 4/10. Configuração não funciona: registro inicial de `shop_settings` não tem `id=1`, e resposta é fixa. |
| Consulta de agenda | Parcial | Agrupamentos e filtros de dados iniciais funcionam; disponibilidade livre é fictícia e constante. |
| Cadastro presencial/busca | Falha | Cadastro não persiste e busca sempre devolve Carlos Mendes. |
| Reserva pelo painel | Parcial | Usa nome informado, mas substitui telefone e vincula toda reserva ao usuário fictício. |
| Registrar falta | Passou no mock | Marca `no_show`. |
| Chegada/procedimentos/pagamento | Falha | Fluxo bloqueado e contrato incompatível com a tela, conforme P1. |
| Caixa: lançamento manual/exclusão | Passou no mock | Cria e exclui lançamento. |
| Caixa: abertura/fechamento | Falha | Duplica registro do mesmo dia e não atualiza o primeiro. |
| Financeiro e comissões | Parcial | Somatórios, divisão comissão/líquido e gerador CSV passam com dados iniciais. Alterar comissão pelo cadastro não funciona. Download/impressão do navegador não foram homologados. |
| Dashboard/BI | Parcial | Receita calculada coincide com financeiro para os dados iniciais. Indicadores após operações quebradas não são confiáveis. |
| Serviço: editar/desativar | Passou no mock | PATCH funciona. |
| Serviço: novo cadastro | Falha | Formulário não envia `active`; o mock não aplica default `true`, então o novo serviço some da lista disponível. |
| Foto do serviço | Não homologado ponta a ponta | Conversão é local em canvas; inspeção de código apenas, sem upload real no formulário. |
| Barbeiro: cadastro/comissão/acesso | Falha | RPCs sem implementação. |
| Foto do barbeiro | Falha no mock | Corpo binário é interpretado como JSON e lança erro antes do upload. |
| Atendentes | Parcial | Perfil e restrição visual de abas funcionam; incluir/remover acesso não persiste. Não é validação de segurança/RLS. |
| Expediente individual | Falha | Filtro `is.null` ignorado e upsert não implementado; mistura horários individuais com gerais. |
| Bloquear agenda | Parcial | Registro pode ser criado/excluído, mas não modifica os horários disponíveis. |
| Área do barbeiro | Parcial | Agenda/avisos carregam; resumo ignora intervalo de datas e taxa configurada. |
| Avisos lidos | Limitação | Mock gera `happened_at` a partir de agora a cada consulta; pode voltar a mostrar avisos antigos como novos. |
| WhatsApp | Link real, não envio automático | Código gera links `wa.me` mesmo na demo. Nenhuma mensagem foi enviada no teste. Não apresentar como canal totalmente simulado. |
| Tema claro/escuro | Passou na interação | Botão alternou para escuro e voltou ao claro no painel. Captura do tema escuro inspecionada; não faz parte dos 41 cenários do simulador. |
| Planos | Conteúdo conferido | Essencial R$ 89,90, até 2 barbeiros; Pro R$ 109,90, ilimitados. Página comercial; não é fluxo de assinatura/cobrança. |
| Instalação do app/PWA | Não homologado | Depende de navegador/dispositivo e contexto de instalação; não testado em celular físico. |
| Atualização disponível | Inspeção de código | Versão HTML e `versao.json` iguais a `services-62`; cenário de versão nova não foi acionado. |
| Reiniciar/sair da demo | Inspeção de código | Reiniciar apaga `demo-db`; sair limpa todo `sessionStorage` da origem. |

## Problemas técnicos de suporte

`limit` e `offset` são ignorados pelo mock. Com 500 ou mais reservas, os consumidores que paginam podem continuar recebendo a mesma página indefinidamente. Ordenação compara números como texto; `is.null` não é aplicado. O simulador não inclui `X-Content-Type-Options: nosniff` em suas respostas. Essas verificações são locais e não descrevem os cabeçalhos do site publicado.

## Avaliação visual

Capturas ficam em `screenshots/`, com medições e texto renderizado em `visual-audit.json`.

Foram registradas 12 capturas sistemáticas (seis páginas em duas larguras), além da recepção e do tema escuro. Nas 12 medições, a largura do conteúdo não ultrapassou a largura da janela. A navegação horizontal interna do painel no celular exige deslizar para alcançar algumas abas.

Nas telas examinadas, tipografia, contraste e cartões têm aparência consistente. No celular, o cabeçalho e a introdução do agendamento ocupam quase toda a primeira tela; o formulário exige rolagem. A faixa fixa da demonstração pode sobrepor a navegação do painel durante a rolagem. Serviços sem fotos usam a mesma tesoura ilustrada; fotos reais ajudariam a apresentação, mas nenhum redesign foi feito.

Larguras de 390 px são emulação no navegador, não teste em aparelho físico. Não confundir ausência de erro de sintaxe ou largura correta com validação funcional.

## Preparação recomendada para amanhã

1. Corrigir primeiro o simulador de chegada/pagamento, remarcação, disponibilidade e caixa.
2. Implementar cadastros de equipe/cliente e os defaults dos serviços; alinhar dados fictícios aos contratos SQL já usados pela interface.
3. Reexecutar os testes e repetir no navegador a sequência completa: agendar → remarcar → chegada → extra/desconto → dinheiro → concluir → conferir caixa e comissão.
4. Até essas correções, limitar a apresentação à navegação, catálogo e relatórios iniciais, explicando que os dados são fictícios. Evitar demonstrar operações que exibem sucesso sem salvar.

O sistema real, RLS, envio de e-mail, CAPTCHA, MFA real, concorrência no banco, publicação Vercel e instalação em celular permanecem fora do escopo confirmado.

## Correções aplicadas (17/11/2026, 2ª rodada)

Simulador `demo-mock.js` reescrito seguindo as funções SQL reais. Resultado: **41 de 41 verificações passam** (`node qa/demo-audit.cjs`); análise estática sem falhas.

- Horários livres: respeitam expediente (domingo fechado), intervalo, duração do serviço, reservas, faltas, bloqueios e horários já passados. Reservar retira o horário; reservar duas vezes o mesmo horário dá erro.
- Chegada cria a ficha; salvar parcial mantém "em atendimento"; extras, desconto e forma de pagamento (inclusive dinheiro) entram no total; concluir finaliza.
- Remarcação altera dia, horário e barbeiro. Caixa do dia atualiza em vez de duplicar.
- Equipe: cadastro de barbeiro, comissão, login vinculado, foto e atendentes salvam.
- Login da equipe após sair: pede o código de 2 etapas; **na demo qualquer código de 6 dígitos vale**.
- Também: cadastro de cliente, cadastro presencial/busca, fidelidade real, sem preferência (barbeiro menos ocupado), recuperar reserva por código, excluir conta, relatório do barbeiro por período, paginação, `nosniff`.
- Testes ajustados ao contrato real da tela (datas futuras, versão da ficha, chegada antes do pagamento).
- Versão dos arquivos passou para `services-63`, para quem já abriu a demo receber o simulador novo.

Conferido no navegador: chegada → ficha → pagamento em dinheiro com extra e desconto → concluído; caixa; barbeiro e comissão; atendente; login com código; remarcação pela conta do cliente; horários na tela de agendamento; sem erros no console.
