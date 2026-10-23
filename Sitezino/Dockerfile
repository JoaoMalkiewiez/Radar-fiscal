FROM node:20-alpine

WORKDIR /app

COPY package.json start.js server.js index.html styles.css app.js ./

ENV NODE_ENV=production
ENV PORT=5500
ENV HOST=0.0.0.0

EXPOSE 5500

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5500/api/health').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1));"

CMD ["node", "start.js"]
