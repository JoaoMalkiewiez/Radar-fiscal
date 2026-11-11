FROM node:20-alpine

WORKDIR /app

COPY package.json start.js server.js serpro-cpf.js index.html styles.css app.js privacidade.html ads.txt cpf.html cpf.css cpf.js juridico.html juridico.css juridico.js patrimonio.html patrimonio.css patrimonio.js ./

# O servidor expõe somente arquivos da lista STATIC_FILES; os assets privados
# precisam existir na imagem para que /juridico/portal não retorne HTTP 404.
COPY juridico-portal.html juridico-portal.css juridico-portal.js juridico-gestao.html juridico-gestao.css juridico-investigacao.js rural-csv.js ./

ENV NODE_ENV=production
ENV PORT=5500
ENV HOST=0.0.0.0

EXPOSE 5500

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5500/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "start.js"]
