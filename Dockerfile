# Usamos uma imagem base do Node.js v20 (LTS) no Debian Bullseye-slim
FROM node:20-bullseye-slim

# Instalar as dependências do sistema operacionais exigidas pelo Puppeteer/Chrome
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Definir a variável de ambiente para que o Puppeteer saiba onde encontrar a instalação do Chrome do sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Criar e definir a pasta de trabalho da aplicação no contêiner
WORKDIR /usr/src/app

# Copiar os arquivos de dependência
COPY package*.json ./

# Instalar as dependências do Node.js
RUN npm install

# Copiar o restante do código da aplicação
COPY . .

# Expor a porta que o servidor Node escuta
EXPOSE 2222

# Comando para iniciar a aplicação
CMD [ "node", "src/server.js" ]
