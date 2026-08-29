#!/bin/bash
# lib-publicar.sh — publicacao ATOMICA de prova (estado, atestado, baseline).
#
# POR QUE UMA LIB. Cada escritor tinha a sua versao do "escreve .parcial e renomeia", e o
# guard contra destino-diretorio so existia em um deles. Isso e o formato classico de
# regressao: a correcao mora em N lugares e volta pelo lugar que ficou de fora.
#
# A ARMADILHA que originou tudo: `mv arquivo diretorio` move o arquivo PARA DENTRO do
# diretorio e retorna 0. Um destino que virou diretorio fazia o escritor declarar sucesso
# sem publicar prova nenhuma — e o leitor seguinte via "arquivo ausente", nao "escrita
# falhou". Medido em 28/08 no varredura-status.
#
#   publicar_atomico <destino> <marcador_obrigatorio> [modo]
#
# Espera que <destino>.parcial ja exista com o conteudo. Entao:
#   1. recusa destino existente que NAO seja arquivo regular (diretorio, link, fifo...);
#   2. exige o <marcador_obrigatorio> dentro do parcial (prova de conteudo, nao so tamanho);
#   3. aplica o modo (padrao 0600) ANTES de publicar, para nao existir janela legivel;
#   4. renomeia com `mv -T` — `-T` trata o destino SEMPRE como arquivo, nunca como diretorio
#      de chegada, entao a armadilha some na origem em vez de depender do guard;
#   5. reconfere no destino final: e arquivo regular, tem o marcador, e o modo bateu.
# Qualquer desvio: remove o parcial e devolve != 0. Nunca deixa lixo parcial no lugar.

publicar_atomico() {
  local dest=$1 marcador=$2 modo=${3:-0600}
  local parcial="$dest.parcial"
  PUBLICAR_MOTIVO=""

  if [ ! -f "$parcial" ]; then
    PUBLICAR_MOTIVO="parcial ausente: $parcial"; return 1
  fi
  # `-L` ANTES de `-f`: o `-f` SEGUE symlink, entao um link apontando para arquivo regular
  # passava como "destino ok". `mv -T` substituiria o link (o alvo fica intacto), mas link
  # nesse caminho e sinal de adulteracao, nao configuracao normal — recusa e o certo.
  if [ -L "$dest" ]; then
    PUBLICAR_MOTIVO="destino e SYMLINK, recusado: $dest -> $(readlink "$dest" 2>/dev/null)"
    rm -f "$parcial"; return 1
  fi
  if [ -e "$dest" ] && [ ! -f "$dest" ]; then
    PUBLICAR_MOTIVO="destino existe e NAO e arquivo regular ($(stat -c %F "$dest" 2>/dev/null)): $dest"
    rm -f "$parcial"; return 1
  fi
  if ! grep -q -- "$marcador" "$parcial" 2>/dev/null; then
    PUBLICAR_MOTIVO="parcial sem o marcador obrigatorio ($marcador): $parcial"
    rm -f "$parcial"; return 1
  fi
  if ! chmod "$modo" "$parcial" 2>/dev/null; then
    PUBLICAR_MOTIVO="nao consegui aplicar modo $modo em $parcial"
    rm -f "$parcial"; return 1
  fi
  # `mv -T` (--no-target-directory): se o destino for diretorio, FALHA em vez de mover para
  # dentro. E o guard acima ja recusou esse caso — cinto e suspensorio, de proposito, porque
  # esta e exatamente a falha que ja passou batido uma vez.
  if ! mv -T -f "$parcial" "$dest" 2>/dev/null; then
    PUBLICAR_MOTIVO="mv atomico falhou para $dest"
    rm -f "$parcial"; return 1
  fi
  if [ ! -f "$dest" ] || ! grep -q -- "$marcador" "$dest" 2>/dev/null; then
    PUBLICAR_MOTIVO="destino publicado mas nao confere ($dest)"; return 1
  fi
  local real; real=$(stat -c '%a' "$dest" 2>/dev/null)
  if [ "$real" != "${modo#0}" ] && [ "$real" != "$modo" ]; then
    PUBLICAR_MOTIVO="destino ficou com modo $real, esperado $modo ($dest)"; return 1
  fi
  PUBLICAR_MOTIVO="ok"
  return 0
}
