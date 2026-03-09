#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════
#  setup_apibrasil.sh — Instala e gerencia o servidor api-multas
#  Projetos: github.com/APIBrasil/api-multas
#            github.com/APIBrasil/api-multas-npm
# ════════════════════════════════════════════════════════════════════════
set -euo pipefail

REPO="https://github.com/APIBrasil/api-multas.git"
INSTALL_DIR="${HOME}/api-multas"
API_PORT=3333
NOSSO_PORT=2222
NOSSO_TOKEN="csi-geradores-$(date +%s)"
PM2_NAME="api-multas-detran"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠️  $*${NC}"; }
fail() { echo -e "${RED}❌ $*${NC}"; exit 1; }
info() { echo -e "   $*"; }

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  API-Multas Brasil — Setup Automático"
echo "  Servidor de scraping DETRAN multi-estados"
echo "══════════════════════════════════════════════════════════════"
echo ""

# ── Verificar dependências ─────────────────────────────────────────────
echo "[1/7] Verificando dependências..."
command -v node >/dev/null 2>&1 || fail "Node.js não encontrado. Instale Node 18+: https://nodejs.org"
command -v yarn >/dev/null 2>&1 || {
  warn "Yarn não encontrado — instalando..."
  npm install -g yarn
}
NODE_VER=$(node -e "console.log(process.versions.node)" 2>/dev/null)
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
[[ "$MAJOR" -ge 16 ]] || fail "Node.js >= 16 necessário (atual: $NODE_VER)"
ok "Node.js v$NODE_VER detectado"

# ── Clonar ou atualizar repositório ───────────────────────────────────
echo ""
echo "[2/7] Repositório api-multas..."
if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Já instalado em $INSTALL_DIR — atualizando..."
  cd "$INSTALL_DIR"
  git pull origin main 2>&1 | tail -2
  ok "Repositório atualizado"
else
  info "Clonando em $INSTALL_DIR..."
  git clone --depth=1 "$REPO" "$INSTALL_DIR"
  ok "Repositório clonado"
fi
cd "$INSTALL_DIR"

# ── Configurar .env ────────────────────────────────────────────────────
echo ""
echo "[3/7] Configurando .env..."
if [[ ! -f ".env" ]]; then
  cp .env-exemplo .env
  info "Arquivo .env criado a partir de .env-exemplo"
fi

# Garantir que a porta seja 3333 (não 2222 que é nosso servidor)
if grep -q "^PORT=" .env 2>/dev/null; then
  sed -i.bak "s/^PORT=.*/PORT=${API_PORT}/" .env
else
  echo "PORT=${API_PORT}" >> .env
fi
ok ".env configurado (PORT=${API_PORT})"

# ── Instalar dependências ──────────────────────────────────────────────
echo ""
echo "[4/7] Instalando dependências (yarn install)..."
yarn install --silent
ok "Dependências instaladas"

# ── Build TypeScript ───────────────────────────────────────────────────
echo ""
echo "[5/7] Compilando TypeScript..."
yarn build 2>&1 | tail -3 || {
  warn "Build falhou — tentando via npx tsc..."
  npx tsc --build tsconfig.json 2>&1 | tail -5
}
[[ -f "dist/index.js" ]] || fail "Build falhou — dist/index.js não encontrado"
ok "Build TypeScript concluído → dist/index.js"

# ── Instalar SDK npm api-multas no projeto principal ───────────────────
echo ""
echo "[6/7] Instalando SDK npm 'api-multas' no projeto principal..."
PROJETO_DIR="${HOME}/motos"
if [[ -d "$PROJETO_DIR" ]]; then
  cd "$PROJETO_DIR"
  if [[ ! -f "package.json" ]]; then
    npm init -y --quiet
  fi
  npm install api-multas --save --silent
  ok "SDK 'api-multas' instalado em $PROJETO_DIR/node_modules"
  cd "$INSTALL_DIR"
else
  warn "Diretório ~/motos não encontrado — SDK não instalado lá"
  warn "Execute manualmente: cd ~/motos && npm install api-multas"
fi

# ── Iniciar com PM2 ───────────────────────────────────────────────────
echo ""
echo "[7/7] Iniciando servidor api-multas com PM2..."
if ! command -v pm2 >/dev/null 2>&1; then
  info "Instalando PM2..."
  npm install -g pm2 --silent
fi

# Para instância existente se houver
pm2 stop   "$PM2_NAME" 2>/dev/null || true
pm2 delete "$PM2_NAME" 2>/dev/null || true

# Inicia
pm2 start dist/index.js --name="$PM2_NAME" \
  --env PORT="$API_PORT" \
  --restart-delay=5000 \
  --max-memory-restart=500M

sleep 3

# Verifica se subiu
if curl -sf "http://localhost:${API_PORT}/status" >/dev/null 2>&1; then
  ok "Servidor api-multas rodando em http://localhost:${API_PORT}"
elif curl -sf "http://localhost:${API_PORT}/" >/dev/null 2>&1; then
  ok "Servidor api-multas OK (porta ${API_PORT})"
else
  warn "Servidor pode ainda estar iniciando — aguarde alguns segundos"
  warn "Verifique: pm2 logs $PM2_NAME"
fi

pm2 save 2>/dev/null || true

# ── Resumo final ──────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo -e "${GREEN}  ✅ INSTALAÇÃO CONCLUÍDA!${NC}"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Servidor api-multas : http://localhost:${API_PORT}"
echo "  PM2 processo        : $PM2_NAME"
echo "  Instalado em        : $INSTALL_DIR"
echo ""
echo "  ▶ Configure o nosso servidor (porta ${NOSSO_PORT}):"
echo "    curl -X POST http://localhost:${NOSSO_PORT}/apibrasil/config \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"host\":\"http://localhost:${API_PORT}\",\"token\":\"meu-token\"}'"
echo ""
echo "  ▶ Testar consulta:"
echo "    curl 'http://localhost:${NOSSO_PORT}/apibrasil/consultar?placa=GQA1234&uf=mg'"
echo ""
echo "  ▶ Ver logs:       pm2 logs $PM2_NAME"
echo "  ▶ Reiniciar:      pm2 restart $PM2_NAME"
echo "  ▶ Status:         pm2 status"
echo ""
echo "  Estados disponíveis: MG, AL, PB, GO, MA, DF, MS, PE, SE, PR, PI, PA, SC"
echo "  CE (nossa frota): continua via DETRAN-CE próprio (CAPTCHA Claude Vision)"
echo ""
