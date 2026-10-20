#!/bin/sh
# Junta a instalação inteira num arquivo só (instalar-tudo.sql). Rode de novo sempre que um .sql mudar.
cd "$(dirname "$0")"
{
 echo "-- GERADO por gerar-instalar-tudo.sh. Não edite aqui: edite os arquivos separados e gere de novo."
 for f in 00-base gestao-profissional horarios-loja sem-preferencia-cliente cancelamento-com-motivo servicos-visuais painel-kryon sem-horario-duplicado barbeiro-fidelidade lgpd seguranca-permissoes; do
  echo; echo "-- ===== $f.sql ====="; cat "$f.sql"
 done
} > instalar-tudo.sql
