#!/bin/sh
# Junta a instalação inteira num arquivo só (instalar-tudo.sql). Rode de novo sempre que um .sql mudar.
cd "$(dirname "$0")"
{
 echo "-- GERADO por gerar-instalar-tudo.sh. Não edite aqui: edite os arquivos separados e gere de novo."
 for f in 00-base equipe-atendente gestao-profissional horarios-loja sem-preferencia-cliente cancelamento-com-motivo servicos-visuais historico-agenda sem-horario-duplicado barbeiro-fidelidade barbeiro-avisos lgpd seguranca-permissoes; do
  echo; echo "-- ===== $f.sql ====="; cat "$f.sql"
 done
} > instalar-tudo.sql
# Banco que já está em uso (criado antes destes arquivos): só as atualizações, na ordem certa.
{
 echo "-- GERADO por gerar-instalar-tudo.sh. Atualiza um banco que já está em uso. Pode rodar mais de uma vez."
 for f in historico-agenda horarios-loja sem-horario-duplicado equipe-atendente gestao-profissional sem-preferencia-cliente cancelamento-com-motivo barbeiro-fidelidade barbeiro-avisos lgpd seguranca-permissoes; do
  echo; echo "-- ===== $f.sql ====="; cat "$f.sql"
 done
} > atualizar-banco-existente.sql
# Trava: nenhum arquivo gerado pode recriar is_admin() sem exigir o código do celular (aal2).
for f in instalar-tudo.sql atualizar-banco-existente.sql; do
 awk '/function public\.is_admin\(\)/{n++;w=4} w&&/aal2/{ok++;w=0} w{w--} END{exit n!=ok}' "$f" || { echo "ERRO: $f recria is_admin() sem exigir aal2" >&2; exit 1; }
done
