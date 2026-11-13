# Laboratório local — execução explícita

**Não faz parte do `npm test` comum.** A missão 01.7 validou a CLI e as proteções locais de configuração, mas a stack não iniciou: o Docker `vfs` esgotou o disco de 7,9 GB durante extração paralela e sequencial. Os runners e o harness estão preparados, **não validados contra Supabase iniciado**; não atribuir aprovação E2E a seus cenários até executá-los. Nenhum destes arquivos altera `server.js`, CSP, URLs ou dados de produção.

## Revisão 01.8 (13/11/2026)

O host continua com Docker `vfs`, filesystem de 7,9 GB e aproximadamente 3,5 GB livres. **Nenhum pull/start adicional foi feito.** A stack e todos os cenários E2E de Supabase continuam BLOQUEADOS; use host com capacidade comprovada antes da fase de execução abaixo. Não trocar driver global nem usar `--ignore-health-check` para contornar o bloqueio.

A revisão corrigiu verificadores permissivos de negativos, integridade parcial e limpeza sem confirmação. Os novos testes são unitários/de protocolo com dependências controladas, **não Auth/RLS/Storage reais**. O runner permanece não validado contra uma stack saudável, mesmo com as guardas aprovadas.

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

O conversor aceita somente origens HTTP limpas em `127.0.0.1` (sem credenciais, caminho, query ou fragmento), arquivos privados fora do Git e container com nome de laboratório. Recusa colisões de arquivos, symlinks e chave administrativa no campo público. Chaves legadas são classificadas pelo campo role apenas para prevenir troca acidental de chaves; isso não verifica assinatura nem substitui a autenticação pelo Supabase. O harness repete essas guardas antes de escutar. O JSON inválido gera erro sanitizado, sem repetir seu conteúdo. O conversor também aplica 0600 ao arquivo privado. Usa a chave administrativa **local** apenas para bootstrap/limpeza. As tentativas RLS/Storage de A/B/C/D usam JWTs reais emitidos pelo login de cada conta, nunca service_role para representar usuários comuns. Antes de executar o runner em outro host, conferir a disponibilidade dos campos de `supabase status -o json` e a origem exclusivamente local das chaves. Nenhuma chave deve ser copiada para o portal/repositório.

## Execução e portal

```bash
node ../../source/Sitezino/lab/validate-real.mjs setup
node ../../source/Sitezino/lab/validate-real.mjs run
node ../../source/Sitezino/lab/portal-harness.mjs
```

O runner cria apenas A/B/C/D com e-mails fictícios destinados ao Mailpit local. A é criada por convite administrativo; demais contas por admin local. Produz `state.private.json` (credenciais/tokens, **não compartilhar**) e `evidence.sanitized.json` (IDs de cenário/estados, sem tokens). Os modos `setup`, `run` e `cleanup` são explícitos; um modo ausente/desconhecido não inicia gravações. Setup exige banco de Auth local vazio. `run` exige setup válido e uma única execução por manifesto: repetir uma rodada iniciada é recusado, evitando perder UUIDs e criar duplicatas. Não repetir setup/run na mesma fixture como tentativa automática: preservar a evidência e investigar falhas. O runner é inicial e não executado nesta infraestrutura; resultados devem ser inspecionados, inclusive falhas por diferença de versão/configuração, antes de qualquer aprovação.

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

As fixtures trazem `run_id` no nome/título/chave. A limpeza valida o manifesto, restringe registros por UUID/proprietário/marcador e objetos por caminhos do lote, confere status das exclusões e consultas de ausência; cada usuário só é removido após confirmar UUID/e-mail sintético esperado. Não marca `cleaned=true` se houver objetos/linhas/usuários restantes, erro, identidade divergente ou cadastro de conta sem resposta reconciliada. A chave administrativa local é usada exclusivamente nesses controles de bootstrap/limpeza; as tentativas RLS usam JWTs dos usuários.

Se `setup`/`run` falhar e o shell interromper por `set -e`, preservar os arquivos privados e abrir nova sessão WSL para limpeza explícita, reexportando SUPABASE_HOME/RADAR_LAB_CONFIG/LAB_CLI. Não reiniciar `run`. Se houver `pendingUsers`, conferir somente o cadastro sintético desse lote no ambiente local e reconciliar seu UUID antes de liberar a limpeza; não inventar IDs, apagar contas amplamente ou remover o bloqueio para obter sucesso. Uma resposta perdida pode ter criado a conta. Depois de reconciliado, `cleanup` confirmado retorna sucesso por sua própria fase, mantendo reprovações anteriores no histórico; `phase_counts` não apaga nem substitui `counts` da suíte.

Negativas do banco exigem SQLSTATE pertinente (`42501`, ou `23503` no vínculo cruzado); erro de payload, JWT inválido, quota ou indisponibilidade não comprova RLS. Erros Storage também precisam de status/código pertinente; 400/500 genéricos não recebem aprovação. A compara seus registros completos com o snapshot e os bytes do objeto após negativas; as tentativas C/D de mutação conferem também a linha original completa por oráculo SQL somente local. Transferências têm até 5 minutos e requisições normais 30 s. Mailpit não segue redirects e o harness rejeita retorno para outra origem. Os formatos GoTrue `error_code`/`code` e erros legados/modernos cobertos por testes ainda devem ser conferidos com as versões reais da stack.

## Missão 01.9 — Codespaces, sem computador local

Configuração opt-in: `.devcontainer/radar-juridico/devcontainer.json`, imagem oficial Universal, Node22, recomendação 4CPU/8GB/64GB de armazenamento. Esses são pedidos ao host, não prova de elegibilidade, capacidade livre ou gratuidade. Docker vem do ambiente Codespaces/Universal; não concedemos `privileged`, montagens de socket ou sudo automático. Se o daemon não estiver disponível, o preflight bloqueia; não iniciar Docker privilegiado para contornar. Nenhum lifecycle instala Supabase ou inicia stack/pulls. Features/imagem são baixadas ao criar/reconstruir o ambiente; portanto **não criar antes da verificação de custo**.

### Única pendência inicial do proprietário: confirmar elegibilidade e custo

1. Na conta pagadora, abrir [Billing and licensing](https://github.com/settings/billing) → Usage/Codespaces e Budgets and alerts. Conferir computação **e armazenamento** restantes no mês e quem paga o repositório. Não enviar tokens ou dados de pagamento. A documentação menciona franquias Free/Pro, mas não prova o saldo desta conta.
2. Confirmar bloqueio efetivo de uso pago para Codespaces: orçamento aplicável com **Stop usage when budget limit is reached** e limite que impeça qualquer excedente pago, ou bloqueio por ausência de pagamento confirmado pelo GitHub. Alerta sozinho não bloqueia cobrança. Não cadastrar cartão, mudar cobrança, contratar plano ou aumentar limite. Se não conseguir confirmar custo incremental zero, **não criar**.
3. Somente com essas confirmações, GitHub → repositório → Code → Codespaces → **New with options**, selecionar branch `fix/juridico-auth-session-security` e configuração **Radar Jurídico — laboratório local isolado**. Conferir a máquina econômica elegível, armazenamento e cobrança antes de Create. Se essa configuração não aparecer, não abrir o ambiente padrão inadvertidamente. Definir idle timeout curto (ex.:15min) e retenção curta nas preferências.
4. No terminal **do Codespace**, executar `node Sitezino/lab/codespaces-preflight.mjs`. Ele não instala nem baixa imagens; verifica Node, escrita, daemon, driver, disco do daemon e memória. Falha de acesso ao filesystem do daemon significa **capacidade desconhecida**, não aprovação pelo espaço do checkout. As margens 30GiB/8GiB são planejamento conservador, não mínimo oficial. Confirmar também limites de memória do host/contêiner (`free -h`, `docker info`) e armazenamento persistente; interromper se insuficientes.
5. Em Settings → Codespaces → Port visibility, manter **Private**; no painel Ports conferir que nenhuma porta está Public/Organization. A configuração desativa auto-forward e não encaminha portas automaticamente, mas não substitui política de visibilidade da conta. Não compartilhar URLs. No CLI oficial, `gh codespace ports visibility --help` documenta como confirmar/configurar `PORT:private` para o Codespace próprio quando necessário.

Depois dessas barreiras, seguir **Preparação → Schema → Execução → Limpeza** deste README, tudo no terminal remoto; nunca fornecer credenciais hospedadas ou executar `supabase link`. Criar ferramentas/estado privado **fora do checkout** em diretório pessoal do Codespace. A receita de Preparação clona o mesmo branch: conferir SHA antes de executar; a máquina remota precisa da margem livre mesmo após instalar as ferramentas. Não automatizamos criação nem execução enquanto a cota estiver desconhecida.

### Rede e interface

Manter Supabase/Mailpit/harness em `127.0.0.1`. Uma URL encaminhada `*.app.github.dev` tem origem diferente do portal `http://127.0.0.1:5517`; abrir essa URL no navegador do proprietário não reproduz o fluxo local e não autoriza mudar whitelist/CSP/redirects. Preferir navegador de testes executado **dentro do Codespace** usando loopback e backend real, com screenshot sanitizado. Se não houver navegador remoto compatível, marcar UI bloqueada; não publicar portas para contornar. Encaminhamento privado autentica acesso, mas não equivale a loopback e precisa de revisão explícita antes de uso.

Ao terminar: cleanup pelo manifesto, confirmar ausência das fixtures, preservar apenas evidência sanitizada fora do Git e parar **somente o Codespace deste laboratório** na página https://github.com/codespaces. Parar computação não elimina consumo de armazenamento: após recolher evidência e conferir cleanup, proprietário deve excluir apenas esse ambiente quando dispensável. Não excluir recursos de terceiros. Cotas e saldo devem ser acompanhados também durante uso. Não usar Actions como E2E alternativo sem verificar recursos/cota/custo; CI de regressão existente permanece separado.

Evidência desta missão: API lista zero Codespaces; máquinas elegíveis e billing usage retornam HTTP403 para a integração. Nenhum ambiente criado, stack iniciada ou E2E executado. Preflight neste executor recusou capacidade desconhecida porque o diretório do daemon não é acessível por `df`; não houve pull/repetição no host limitado.
