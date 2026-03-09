#!/bin/bash

# ==============================================================================
# Script de Instalação Automatizada - MotoGestão (VPS Ubuntu/Debian)
# ==============================================================================
# Executar este script na sua VPS via SSH:
# chmod +x install_vps.sh
# sudo ./install_vps.sh
# ==============================================================================

# Cores para logs
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}======================================================${NC}"
echo -e "${GREEN}Iniciando a instalação do MotoGestão na VPS...${NC}"
echo -e "${BLUE}======================================================${NC}\n"

# 1. Atualizar o sistema
echo -e "${BLUE}[1/8] Atualizando pacotes do sistema...${NC}"
sudo apt update && sudo apt upgrade -y

# 2. Instalar dependências gerais e dependências do Puppeteer
echo -e "${BLUE}[2/8] Instalando dependências do sistema e do Puppeteer...${NC}"
sudo apt install -y curl git wget build-essential unzip \
    libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libxss1 libxtst6 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    libasound2 libx11-6 libxcb1 libxext6 libcups2 libdrm2 \
    libxkbcommon0 libpango-1.0-0 libcairo2 libgbm1 nginx ufw

# 3. Instalar Node.js (Versão 20 LTS)
echo -e "${BLUE}[3/8] Instalando Node.js (v20)...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verificar instalação
echo "Node.js versão: $(node -v)"
echo "NPM versão: $(npm -v)"

# 4. Configurar Repositório do Projeto
DIR_APP="/var/www/motogestao"

echo -e "${BLUE}[4/8] Baixando a aplicação do GitHub...${NC}"
if [ -d "$DIR_APP" ]; then
    echo -e "${RED}O diretório $DIR_APP já existe. Atualizando código...${NC}"
    cd "$DIR_APP"
    # Certificar-se de descartar alterações locais para baixar o código novo
    sudo git reset --hard
    sudo git pull origin main
else
    echo "Clonando repositório para $DIR_APP..."
    # A clonagem do repositório público (ou exigindo token se privado)
    # Se o repo for privado, o git pedirá senha. É recomendado usar a versão pública para clone fácil ou gerar chave SSH.
    sudo git clone https://github.com/patricklimaalex/motogestao.git "$DIR_APP"
fi

cd "$DIR_APP"
# Corrigir permissões da pasta
sudo chown -R $USER:$USER "$DIR_APP"

# 5. Instalar dependências do Node no projeto
echo -e "${BLUE}[5/8] Inicializando o projeto e instalando pacotes NPM...${NC}"
if [ ! -f "package.json" ]; then
    npm init -y
fi

# Instalar os módulos básicos necessários no servidor
npm install express cors axios puppeteer puppeteer-core puppeteer-extra puppeteer-extra-plugin-stealth

# 6. Configurar o PM2 (Gerenciador de Processos Node.js)
echo -e "${BLUE}[6/8] Instalando o PM2 e iniciando o Servidor...${NC}"
sudo npm install -g pm2

# Parar se já estiver rodando
pm2 stop multas_server 2>/dev/null || true

# Iniciar o servidor Multas (que roda na porta 2222)
pm2 start multas_server.js --name "multas_server"

# Fazer o PM2 iniciar automaticamente com o boot da VPS
pm2 save
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $USER --hp /home/$USER

# 7. Configurar Nginx Avançado (Proxy Reverso)
echo -e "${BLUE}[7/8] Configurando Nginx para redirecionar porta 80 -> 2222...${NC}"
sudo rm -f /etc/nginx/sites-enabled/default

# Criar a configuração do Nginx (Seu app web vai rodar direto pelo IP sem precisar de porta 2222)
cat <<EOF | sudo tee /etc/nginx/sites-available/motogestao
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass http://localhost:2222;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/motogestao /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 8. Configurar Firewall
echo -e "${BLUE}[8/8] Configurando Firewall (UFW)...${NC}"
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 2222/tcp  # Opcional se for acessar por porta
sudo ufw --force enable

echo -e "\n${GREEN}======================================================${NC}"
echo -e "${GREEN} INSTALAÇÃO CONCLUÍDA COM SUCESSO! 🚀${NC}"
echo -e "${GREEN}======================================================${NC}"
echo -e "O servidor já está rodando em background com o PM2."
echo -e "O Nginx está direcionando o tráfego da porta 80 para a aplicação."
echo -e "\n${BLUE}Verifique se está tudo funcionando:${NC}"
echo -e "1. O IP da sua VPS, Exemplo: http://IP_DA_VPS"
echo -e "2. O PM2 (Logs do Scraper): pam2 logs multas_server"
echo -e "======================================================\n"
