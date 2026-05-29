#!/usr/bin/env bash
# Diagnóstico do Claude CLI — replica a invocação EXATA de produção (claude.js).
export HOME=/opt/LA-Organizer/.claude-tom
export CLAUDE_HOME=/opt/LA-Organizer/.claude-tom/.claude

# system prompt grande pra simular o TOM real (~4KB)
SYS="Você é o TOM, assistente da LA Music. $(head -c 4000 /dev/zero | tr '\0' 'x')"

run() {
  local n=$1
  local start=$(date +%s)
  local out
  out=$(timeout 70 /usr/bin/claude -p 'responda apenas: ok' \
    --model sonnet \
    --append-system-prompt "$SYS" \
    --output-format json \
    --strict-mcp-config \
    --mcp-config '{"mcpServers":{}}' \
    --tools '' 2>&1)
  local code=$?
  local end=$(date +%s)
  local model=$(echo "$out" | grep -oE '"claude-[a-z0-9.-]+(\[1m\])?"' | head -1)
  local iserr=$(echo "$out" | grep -oE '"is_error":[a-z]+' | head -1)
  local sub=$(echo "$out" | grep -oE '"subtype":"[a-z_]+"' | head -1)
  echo "run#$n: exit=$code dur=$((end-start))s model=$model $iserr $sub"
  if [ $code -ne 0 ] || echo "$out" | grep -q '"is_error":true'; then
    echo "  >> RAW: $(echo "$out" | head -c 400)"
  fi
}

echo "=== 3 chamadas sequenciais com --model sonnet (config de producao) ==="
run 1
run 2
run 3
