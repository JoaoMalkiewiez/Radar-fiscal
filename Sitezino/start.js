"use strict";

// Em redes corporativas, o Node pode não confiar no certificado do proxy TLS.
// A variável abaixo faz o Node usar o repositório de CAs do sistema operacional.
// Em versões antigas do Node ela é simplesmente ignorada.
const { spawn } = require("child_process");

const child = spawn(process.execPath, ["server.js"], {
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_USE_SYSTEM_CA: "1",
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
