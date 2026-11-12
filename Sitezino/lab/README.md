# Laboratório local — execução explícita

**Não faz parte do `npm test` comum.** A missão 01.7 validou a CLI e as proteções locais de configuração, mas a stack não iniciou: o Docker `vfs` esgotou o disco de 7,9 GB durante extração paralela e sequencial. Os runners e o harness estão preparados, **não validados contra Supabase iniciado**; não atribuir aprovação E2E a seus cenários até executá-los. Nenhum destes arquivos altera `server.js`, CSP, URLs ou dados de produção.

## Requisitos e Windows/WSL2

1. Windows 10/11 compatível, WSL2 com Ubuntu e Docker Desktop com integração habilitada **para essa distribuição**. Conferir elegibilidade da licença gratuita antes de instalar; se a licença de uso exigir assinatura, não contratar. Alternativa: Docker Engine em Linux existente.
2. Em PowerShell do Windows, verificar `wsl --status` e `wsl --list --verbose`. Ubuntu deve estar em versão 2; executar o restante **no terminal Ubuntu/WSL**, não em PowerShell. Habilitar Docker Desktop → Settings → Resources → WSL Integration → Ubuntu.
3. Na máquina existente, reservar memória para a stack e espaço para imagens/expansão. Recomendação operacional: pelo menos 8 GB disponíveis de RAM e 30 GB livres no disco do Docker; não é um mínimo oficial nem garantia para todo driver. Verificar o disco virtual do Docker, além do disco do repositório. Não trocar storage driver nem fazer prune global para contornar limite.
4. No WSL: `docker version`, `docker info`, `free -h`, `df -h`. Conservar políticas/proxy/CA da organização. Não forçar HOME nem ampliar permissões globais. Manter APIs/Studio/Mailpit em loopback, sem túnel ou exposição na internet.
5. Node 22+ e Git disponíveis. Instalar a CLI gratuita por release oficial, fixando a versão. Nesta missão a versão atual consultada foi **3.1.0**; não usar `latest` silenciosamente para reproduzir resultados.

## Preparação (WSL/Linux; nenhuma produção)

Use o filesystem Linux (`~/...` em sua máquina própria) e um diretório novo. Estes comandos destinam-se à máquina do operador, não autorizam escrever no home do executor gerenciado.

```bash
set -euo pipefail
mkdir -p radar-juridico-local/tools radar-juridico-local/work/lab
cd radar-juridico-local
curl -fL https://github.com/supabase/cli/releases/download/v3.1.0/supabase_3.1.0_linux_amd64.tar.gz -o tools/cli.tar.gz
curl -fL https://api.github.com/repos/supabase/cli/releases/tags/v3.1.0 -o tools/release.json
node --input-type=module -e 'import fs from "node:fs"; import crypto from "node:crypto"; const r=JSON.parse(fs.readFileSync("tools/release.json")); const expected=r.assets.find(a=>a.name==="supabase_3.1.0_linux_amd64.tar.gz")?.digest; const actual="sha256:"+crypto.createHash("sha256").update(fs.readFileSync("tools/cli.tar.gz")).digest("hex"); if(!expected||expected!==actual)throw Error("CLI checksum mismatch"); console.log("CLI digest verified");'
tar -xzf tools/cli.tar.gz -C tools supabase
export SUPABASE_HOME="$PWD/work/cli-state"
export SUPABASE_TELEMETRY_DISABLED=1
"$PWD/tools/supabase" --version
"$PWD/tools/supabase" --help
"$PWD/tools/supabase" start --help
```

`SUPABASE_HOME` é o override suportado no [código oficial v3.1.0](https://github.com/supabase/cli/blob/v3.1.0/apps/cli/src/shared/config/supabase-home.ts). Controla o estado da **CLI**, sem modificar `HOME`, `CODEX_HOME` ou permissões globais. `SUPABASE_CONFIG_DIR` não resolveu a inicialização anterior e não deve ser presumido substituto.

```bash
git clone --branch fix/juridico-auth-session-security https://github.com/JoaoMalkiewiez/Radar-fiscal.git source
export LAB_CLI="$PWD/tools/supabase"
cd work/lab
"$LAB_CLI" init
```

Editar **somente** o `supabase/config.toml` novo do laboratório: `project_id="radar-juridico-e2e"`, Auth `site_url="http://127.0.0.1:5517/juridico/portal"`, retorno adicional exato para esse portal e `jwt_expiry=60` para o caso de expiração real. Não editar arquivo de produção. Não executar `supabase link` nem fornecer token hospedado. Consultar ajuda da versão para todas as operações.

```bash
umask 077
"$LAB_CLI" start --exclude realtime,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor > start.private.log 2>&1
"$LAB_CLI" status -o json > status.private.json
docker ps --format '{{.Names}} {{.Ports}}'
```

Não publicar os logs/status: podem conter chaves. Confirmar todos os bindings `127.0.0.1`; a CLI 3.1.0 implementa publicação em loopback. Se houver falta de disco, interromper e corrigir capacidade antes de repetir; não usar `--ignore-health-check` para declarar stack saudável. A CLI pode tentar pulls novamente; cancelar uma execução que repete o mesmo erro de capacidade.

## Schema e configuração privada

Identificar o container Postgres desta execução (nome `supabase_...radar...`), conferir seu label/projeto e substituir somente a variável abaixo. Nunca apontar para outro banco. Aplicar os SQL em **banco local vazio**, na ordem, sem dados de produção:

```bash
export LAB_DB_CONTAINER='NOME_DO_CONTAINER_POSTGRES_DESTE_LAB'
docker exec -i "$LAB_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../../source/Sitezino/database/radar-juridico.sql
docker exec -i "$LAB_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../../source/Sitezino/database/authorized-access-and-movements.sql
docker exec -i "$LAB_DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < ../../source/Sitezino/database/private-audit-trail.sql
node ../../source/Sitezino/lab/configure-private.mjs status.private.json "$LAB_DB_CONTAINER" config.private.json
export RADAR_LAB_CONFIG="$PWD/config.private.json"
```

O conversor aceita somente URLs HTTP em `127.0.0.1`, arquivos privados fora do Git e container com nome de laboratório. Usa a chave administrativa **local** apenas para bootstrap/limpeza. As tentativas RLS/Storage de A/B/C/D usam JWTs reais emitidos pelo login de cada conta, nunca service_role para representar usuários comuns. Antes de executar o runner em outro host, conferir a disponibilidade dos campos de `supabase status -o json` e a origem exclusivamente local das chaves. Nenhuma chave deve ser copiada para o portal/repositório.

## Execução e portal

```bash
node ../../source/Sitezino/lab/validate-real.mjs setup
node ../../source/Sitezino/lab/validate-real.mjs run
node ../../source/Sitezino/lab/portal-harness.mjs
```

O runner cria apenas A/B/C/D com e-mails fictícios destinados ao Mailpit local. A é criada por convite administrativo; demais contas por admin local. Produz `state.private.json` (credenciais/tokens, **não compartilhar**) e `evidence.sanitized.json` (IDs de cenário/estados, sem tokens). Não repetir setup/run na mesma fixture como tentativa automática: preservar a evidência e investigar falhas. O runner é inicial e não executado nesta infraestrutura; resultados devem ser inspecionados, inclusive falhas por diferença de versão/configuração, antes de qualquer aprovação.

Portal em `http://127.0.0.1:5517/juridico/portal`: harness só escuta loopback e faz proxy **real** para Auth/REST/Storage local. Não simula respostas desses serviços e não muda validação de URLs/CSP do app de produção. O endpoint de configuração retorna somente a chave pública. Testar desktop/mobile, login A/B e gate C/D, CRUD, documentos, logout/reentrada/troca de usuário, recovery no Mailpit e mensagens; anotar evidências sem URLs/token/senha. O status secreto da CLI e o manifesto privado não devem ir para console, HAR, Git ou screenshots. Recuperação local não comprova SMTP/URLs hospedados.

O runner contempla controles positivos, tentativas cruzadas, owner/FKs, auditoria, revogação de D, arquivos, login/recovery/refresh/logout e expiração real de 60 s. A verificação de MIME testa o tipo declarado no Storage, **não antivírus ou inspeção de conteúdo**. Revalidar payloads e resultados em stack funcional; nenhum destes casos recebeu APROVADO nesta missão.

## Limpeza e regressão

Depois do navegador, finalizar apenas o processo do harness e executar:

```bash
node ../../source/Sitezino/lab/validate-real.mjs cleanup
"$LAB_CLI" stop --help
"$LAB_CLI" stop
cd ../../source/Sitezino
npm test
node --check juridico-portal.js
node --check juridico-investigacao.js
node --check test/juridico-auth.test.js
node --check test/server.test.js
```

Limpeza usa somente UUIDs/caminhos do manifesto privado do laboratório. Confirmar remoção das fixtures, inclusive registros criados manualmente no navegador, antes de descartar volumes. Não usar DELETE amplo, prune global, produção ou usuário existente. Guardar evidências sanitizadas e apagar as credenciais locais conforme retenção aprovada. Não emitir evidência de limpeza concluída antes de conferir a stack.
