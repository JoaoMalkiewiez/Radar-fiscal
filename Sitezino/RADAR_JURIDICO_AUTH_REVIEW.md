# Missão 01 — revisão de autenticação e segurança

Data: 11/11/2026. Base inspecionada: `main` em `721b8d5`.
Branch: `fix/juridico-auth-session-security`. [PR #12](https://github.com/JoaoMalkiewiez/Radar-fiscal/pull/12), implementação `cf17cfa`. Relacionado à issue #10.

A implementação desta missão está disponível para revisão. A etapa 01 continua **parcialmente bloqueada**: a inspeção de políticas e os testes simulados não substituem E2E com contas de teste no Supabase. Não houve merge, deploy, migração, alteração de configuração externa ou leitura/escrita de registros de clientes.

## Problemas corrigidos

- Uma resposta de renovação podia restaurar tokens depois da saída. Agora cada sessão possui uma versão; respostas de uma sessão encerrada são rejeitadas, inclusive no carregamento de tabelas. Requisições concorrentes compartilham uma única renovação. HTTP 401 permite somente uma renovação/repetição; HTTP 403 encerra a sessão local.
- O logout ocultava o painel, mas deixava nomes, listas, formulários e vínculos no DOM. Agora limpa estado, listas, formulários, buscas, seletores e contadores. Dados das tabelas são publicados juntos, depois que todas as respostas forem válidas.
- O fragmento do convite só era removido depois de carregar a configuração. Agora é consumido antes de esperar pela rede, inclusive quando a configuração falha. Links incompletos, tipos desconhecidos, erros do provedor e duração inválida são rejeitados. Parâmetros sensíveis de query são removidos e rejeitados; este cliente continua usando o fluxo implícito existente, sem implementar PKCE ou aceitar retorno arbitrário. A recuperação usa apenas a origem atual + `/juridico/portal`. A página envia política de referrer `no-referrer`.
- Erros de rede, timeouts por tipo de operação, HTTP 5xx, resposta Auth vazia/nula e HTTP 429 têm mensagens sem conteúdo bruto do provedor. Senha incorreta permanece mensagem genérica sobre credenciais, sem confirmar existência da conta. Botões de Auth mostram andamento e `aria-busy`.
- O tratamento anterior de limite de e-mails foi preservado. HTTP 429 também passa a impor espera em memória, respeitando `Retry-After`, com mínimo/fallback de 60 segundos. A espera não promete a liberação do provedor e não gera repetição automática nem contorna cotas. Recarregar limpa a espera local; o limite efetivo continua sendo do Supabase.
- No mobile, `.sidebar-bottom` ocultava também o botão de logout. O CSS específico do portal agora mantém esse bloco visível em telas de até 900 px.

Tokens continuam somente em memória; nenhum segredo foi adicionado. APIs, consultas públicas CNPJ/CPF/SEFAZ, fontes e contratos de investigação, estrutura de dados, Dockerfile e políticas RLS foram preservados. O script de investigação recebeu apenas as guardas de sessão descritas abaixo.

## Evidências executadas

| Verificação | Resultado e alcance |
| --- | --- |
| Linha de base `npm test` | 46/46 aprovados antes de editar |
| `npm test` na primeira entrega | 83/83 aprovados: 46 existentes + 37 testes de comportamento do portal |
| `npm test` após primeira correção de revisão | 135/135 aprovados: todos os 83 anteriores + 52 cenários novos de sessão/transferências |
| `npm test` após revisão CRUD | 207/207 aprovados: todos os 135 anteriores + 72 cenários novos de CRUD/sessão |
| `npm test` na conferência final de 12/11/2026 | 234/234 aprovados: todos os 207 anteriores + 27 cenários explícitos de reentrada CRUD |
| `node --check` | Aprovado em `juridico-portal.js`, `juridico-investigacao.js`, `test/juridico-auth.test.js`, `test/server.test.js` |
| `git diff --check` | Aprovado |
| Chromium, desktop 1440 px e mobile 390 px | Login autorizado, logout acessível, limpeza do DOM, recuperação 429 sem repetição de envio, convite/redefinição, URL limpa, storage vazio e ausência de erros JS. Servidor local e respostas Supabase interceptadas com dados fictícios; não é E2E real do provedor |
| Regressão fiscal | Testes existentes de CNPJ, CPF/Serpro, monitor SEFAZ, DataJud, SNCR, rotas e Docker aprovados; não foram feitas consultas reais a pessoas |
| Produção, leitura pública | `/`, `/juridico`, `/juridico/portal`, `/api/health`: HTTP 200. Reflete a versão já publicada, não esta branch |
| Supabase, consultas somente de catálogo | RLS habilitada nas sete tabelas `legal_*`; `anon` sem SELECT/INSERT; usuários autenticados sem UPDATE em `legal_access` e auditoria. Políticas de registros exigem `owner_id = auth.uid()` e autorização ativa, incluindo WITH CHECK; Storage exige pasta do usuário e autorização ativa. Bucket privado, limite 10 MB |
| Security Advisors real | Um aviso: proteção contra senhas vazadas desativada. Nenhuma política ou configuração alterada |

Ambiente local: Node `v24.22.1`; CI jurídico existente utiliza Node 22 e a imagem existente utiliza Node 20. Não foram introduzidas dependências. A rotina de testes usa `node:test`/`vm`, DOM mínimo e HTTP sintético; verifica a execução do script real, sem copiar a implementação para os testes. O teste estático antigo foi ajustado para aceitar a sanitização da query, coberta por teste de comportamento.

Security Advisor: [proteção de senhas no Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Avaliar disponibilidade no plano atual; não contratar serviço pago para resolver o aviso.

## Pendências externas e limites

- Não havia credenciais de contas sintéticas disponíveis para autenticar no projeto. Não criamos contas, não enviamos e-mails reais e não consultamos clientes/documentos. Convite real, recuperação real, entrega SMTP, revogação real e comportamento multiusuário ainda precisam ser validados.
- Conferir manualmente Site URL e Redirect URLs do Supabase: domínio de produção e `/juridico/portal`; não foi possível verificar essas configurações pelas ferramentas disponíveis. Um link inicial emitido com localhost continua dependendo da correção da configuração externa; a branch preserva o retorno fixo de recuperação já existente.
- A inspeção de catálogo confirma definições de RLS, permissões e bucket, mas não prova execução de isolamento, CRUD, vínculos compostos e download com JWTs de usuários diferentes.
- Render MCP não tinha workspace selecionado e exigiu escolha confirmada do usuário. Não selecionamos workspace nem alteramos serviços. Dockerfile/workflows foram inspecionados; SHA e metadados do deploy não foram confirmados no painel Render. O smoke HTTP público foi executado separadamente.
- A página HTML do portal é uma interface pública sem registros embutidos. A autorização efetiva das rotas REST e do Storage pertence ao Supabase. Os testes de 403 e de ausência de sessão no cliente usam respostas simuladas; não substituem testes RLS reais.
- A remoção de tokens no navegador não apaga logs anteriores de um link incorreto com credenciais em query. Usar os links oficiais do fluxo implícito; não enviar tokens pela query. `no-referrer` protege navegações/recursos subsequentes após a leitura da política.
- Tokens JWT já emitidos podem permanecer válidos até expirar após logout remoto. Para conta desativada, as políticas consultam autorização ativa nas operações; o procedimento administrativo de revogar sessões permanece necessário. Não foi adicionado timer para atualizar a UI imediatamente ao desativar uma conta em outro navegador.

## Riscos e reversão

Escopo concentrado no portal privado. Riscos principais: respostas Auth sem `expires_in` válido agora são rejeitadas; HTTP 403 exige novo login; falha de renovação encerra sessão e descarta formulários. Transferências continuam sujeitas a um limite finito de 5 minutos; falhas podem deixar objetos sem metadados, exigindo conferência antes de reenviar. Uma requisição de escrita já aceita pelo servidor antes do logout não é desfeita pelo descarte da resposta. Conferir o registro antes de repetir uma operação cujo resultado ficou incerto. O bloco de saída aparece no mobile e ocupa espaço adicional na navegação. Não há alteração de schema ou migração para reverter.

Reversão: reverter o commit desta branch mediante revisão normal, sem reaplicar SQL ou alterar dados. Não fazer merge até revisão independente e aprovação. O CI verde e a revisão desta correção não encerram a etapa 01 sem as pendências externas.

## Validação para o GPT-6

1. Revisar o diff e confirmar escopo em Auth/UI/testes/docs; preservar a proibição de merge e deploy até decisão explícita de publicação.
2. Em `Sitezino`, executar `npm test` e `node --check` nos quatro JS alterados no PR. Conferir os workflows do PR e comparar o SHA testado com o head.
3. Em ambiente de teste, conferir Site URL/Redirect URLs e configuração de cadastro fechado. Preparar contas sintéticas A/B autorizadas, C sem `legal_access` e D desativada, sem registrar credenciais em chat, logs ou repositório.
4. Testar convite válido/expirado, senha inválida, recuperação válida/429, redefinição e reentrada, refresh após expiração, falha de rede e logout em desktop/mobile. Confirmar limpeza da URL e ausência de tokens em storage/logs.
5. Com A, criar cliente/processo/evento/movimentação e documento sintéticos. Com B, tentar SELECT/PATCH/DELETE por UUID de A, INSERT/PATCH com owner de A, vínculos com cliente/processo de A e download/listagem/exclusão do objeto de A. Confirmar bloqueio, conferir que A continua íntegro e que B só vê seus próprios registros.
6. Confirmar bloqueio de C/D via UI **e diretamente** em REST/Storage; desativar autorização de conta sintética com sessão aberta e verificar novas operações. As duas contas autorizadas também devem ter CRUD próprio funcional. Excluir apenas fixtures criadas para o teste; considerar trilha de auditoria e política de retenção.
7. Executar novamente Security Advisors; registrar evidências sanitizadas e limites SMTP. Só depois avaliar fechamento da issue #10 e mudança da etapa no roadmap. Não iniciar etapa 02 nesta revisão.


## Correções após revisão independente do GPT-6

Referência: [comentário de revisão](https://github.com/JoaoMalkiewiez/Radar-fiscal/pull/12#issuecomment-6803938154). Continuação na mesma branch e no mesmo PR, sem merge/deploy. Os 83 testes anteriores foram mantidos. **A etapa 01 continua parcialmente bloqueada e nenhum E2E real Supabase foi declarado concluído.**

### Isolamento das consultas assíncronas

CNPJ, DataJud e SNCR capturam a geração `sessionVersion` e o usuário no início de cada consulta autorizada. Após **cada await** e antes de alterar resultados, status, botões ou campo de arquivo, verificam se a sessão original ainda está ativa e visível. `catch` e `finally` também respeitam essa guarda. Uma renovação de token na mesma sessão não descarta a consulta; logout e reentrada, inclusive da mesma conta, invalidam a geração antiga.

O logout limpa os três status/resultados e reabilita os controles para permitir novas consultas. Callbacks antigos não podem sobrescrever a consulta de B, habilitar seu botão enquanto ela está pendente ou apagar seu arquivo CSV. A mesma proteção impede que um upload antigo crie metadados, faça limpeza ou altere controles de outra sessão. Consultas iniciadas anteriormente podem continuar na fonte; seus resultados e erros são descartados, sem repetição automática e sem armazenamento persistente.

### Política de timeout e resultado de gravação

- Auth, configuração e operações REST/Storage comuns: **30 segundos** por requisição; exclusão de objeto usa o limite comum.
- Upload POST/PUT e download GET no Storage: **5 minutos**, mantendo o limite de tamanho e tipos já existentes (até 10 MB). Esse orçamento permite transferências lentas sem o corte anterior de 20 segundos, mas não garante disponibilidade da rede/provedor.
- Falha de rede, timeout, HTTP 5xx ou corpo interrompido em uma escrita REST/Storage informa **resultado da gravação incerto**, orientando conferir registros e arquivos antes de repetir. Não há nova tentativa automática nesses casos; permanece apenas o fluxo existente de uma renovação/repetição após resposta HTTP 401.
- Se o upload foi confirmado e a resposta dos metadados se perdeu, o objeto **não é excluído automaticamente**, porque os metadados podem ter sido gravados. Rejeição definitiva dos metadados mantém a limpeza anterior, desde que a sessão original permaneça ativa. Falha de listagem após confirmação de upload e metadados informa que o documento foi salvo e preserva o arquivo.

### Novas evidências e roteiro para o revisor

- **52 testes novos**, com os dois scripts reais no mesmo contexto `vm`, respostas pendentes e dados fictícios: bloqueio durante autorização/fetch/leitura de JSON ou CSV; logout; login B pelo handler real; reentrada A; falha tardia; preservação de status, resultados, botão e arquivo da nova sessão; sucesso na sessão original.
- Relógio determinístico e `AbortSignal` real verificam aborto comum em 30 s, upload/download que permanecem ativos após 120 s, aborto de upload em 300 s, PDF de exatamente 10 MB pelo formulário, ausência de repetição e tratamento de escrita incerta. Não houve espera real de 5 minutos nem transferência de documento real ao Supabase.
- **`npm test`: 135/135 aprovados**, sem testes removidos ou ignorados; `node --check` nos quatro JS do PR e `git diff --check` aprovados.
- Chromium com respostas sintéticas: testes anteriores de autenticação em 1440/390 px; CNPJ, DataJud e SNCR com resposta/leitura atrasada de A, logout e login B em 390 px, preservando resultados/status/controles de B e sem erros JS.
- GitHub Actions: os workflows existentes são acionados pela atualização do PR. O comentário de entrega registra o novo SHA e os links/resultados dos checks desse head; conferir essa correspondência antes da revisão.

Revisar especialmente `catch/finally` em `juridico-investigacao.js`, a limpeza feita por `logout()`, o orçamento de transferências em `request()/api()` e o caminho de confirmação/limpeza de documentos. Reexecutar `npm test` e verificar os cenários de atraso com `node --test test/juridico-auth.test.js`. As validações reais multiusuário, RLS/Storage, Auth URLs e SMTP permanecem na seção de pendências, sem alteração de políticas ou dados externos.


## Revisão residual — mensagens, formulários e controles CRUD

Referência: [segunda revisão GPT-6](https://github.com/JoaoMalkiewiez/Radar-fiscal/pull/12#issuecomment-6806329899), sobre o commit `8304706`. Continuação no mesmo PR #12 e branch `fix/juridico-auth-session-security`. Sem merge/deploy; etapa 01 permanece **parcialmente bloqueada** e etapa 02 não foi iniciada.

### Correção

- `insert`, `updateRecord` e `removeRecord` capturam a geração original. Verificam a geração após cada await, antes de prosseguir para nova requisição/listagem ou publicar mensagem de sucesso. A exclusão de documento verifica também a fronteira entre remover o objeto e remover metadados, impedindo que uma continuação de A use a sessão B.
- `bindForm` só limpa o formulário, publica erro ou reabilita o botão se a geração original ainda estiver ativa. O editor inline e os botões criados por `createButton` aplicam a mesma guarda em `catch/finally`, cobrindo edição, conclusão e exclusão usadas pela interface existente.
- O logout reabilita os botões dos formulários fixos de clientes, processos, agenda e movimentações para que B possa operar imediatamente. Os controles dinâmicos são removidos com as listas; callbacks antigos não modificam nem os controles destacados. Nenhum contrato, fonte, tabela ou política foi alterado.

### Evidências desta correção

- `npm test` em `Sitezino`: **207/207 aprovados**, incluindo os 135 anteriores e **72 novos testes**, sem remoção ou skip.
- Matriz com operações reais do script em contexto `vm`: cadastro, edição, exclusão de registro e de documento, atrasos na gravação/Storage/listagem, sucesso tardio, HTTP 503 e falha de rede, logout sem nova sessão e logout seguido de login B pelo handler de autenticação. Confirma preservação de feedback, rascunhos e controles de B, e ausência de requisições subsequentes de A na sessão B.
- Casos de sucesso/erro na sessão original preservam mensagens, limpeza e reativação de controles. Cadastros de processo, agenda e movimentação também têm cobertura de resposta tardia. Testes unitários nas fronteiras de microtask entre `api`/`reloadData` e seus callers verificam especificamente as guardas pós-await dos helpers.
- `node --check`: `juridico-portal.js`, `juridico-investigacao.js`, `test/juridico-auth.test.js` e `test/server.test.js`; `git diff --check`: aprovados.
- Chromium local em **390 px**, com dados fictícios e HTTP interceptado: A inicia cadastro/edição/exclusão, faz logout, B entra e inicia cadastro; a resposta de A chega enquanto B ainda aguarda. Mensagem, campo e botão de B permanecem intactos; ao liberar a resposta de B, seu cadastro conclui normalmente, com reset e botão reabilitado. Sem erros JavaScript.
- O comentário de entrega no PR registra o novo SHA e os resultados/links dos dois GitHub Actions nesse head. Os testes de navegador e VM usam respostas sintéticas, **não E2E real Supabase**.

### Riscos, pendências e revisão

A proteção descarta continuações da sessão encerrada; não cancela nem desfaz uma escrita já aceita pelo servidor. Uma exclusão interrompida pela troca de sessão pode precisar de conferência dos objetos/metadados pela conta original. Após logout, mensagens de operações antigas são suprimidas, e não transferidas para B. Na sessão original, o comportamento e os erros existentes permanecem preservados. Reversão desta correção exige apenas reverter seu commit, sem SQL.

Para o GPT-6: revisar a geração capturada nos quatro helpers e nos handlers inline/botões, repetir `npm test`, conferir o SHA dos GitHub Actions e reproduzir o fluxo A→logout→login B com uma operação de B pendente. Autenticação real A/B/C/D, isolamento REST/Storage, URLs Auth e SMTP continuam pendentes; não concluir etapa 01 nem publicar com base apenas nestas simulações.


## Conferência final — 12/11/2026

O pedido final referencia `8304706`, mas a correção de produção dos quatro fluxos já está no commit `fc4ffa3`, preservado nesta branch. A conferência confirmou `sessionVersion` em `bindForm`, `insert`, `updateRecord` e `removeRecord`, inclusive antes de novas requisições e mensagens pós-await. Editor inline e botões também mantêm as guardas de `catch/finally`. Não foi necessário reimplementar ou alterar a correção de produção.

Foi adicionada a matriz explícita do **Teste F — reentrada do mesmo usuário**: cadastro, edição, exclusão de registro e documento, com atraso de escrita/Storage/listagem e resposta de sucesso/503/erro de rede. O login real do handler devolve o mesmo UUID sintético, mas a geração aumenta. Os 27 novos cenários verificam que a antiga sessão não altera listas, mensagens, formulários ou controles e não inicia requisições adicionais. A matriz anterior A→B também ganhou verificação de preservação dos registros em memória.

Correspondência dos requisitos obrigatórios:

| Teste | Evidência automatizada |
| --- | --- |
| A — Cadastro | bindForm real, POST/listagem pendente, logout/login B; mensagem, rascunho, botão e registros atuais preservados |
| B — Edição | editor inline real e updateRecord, PATCH/listagem pendente; interface atual preservada |
| C — Exclusão | createButton/removeRecord, DELETE de registro/objeto/metadados/listagem; sem continuação pela sessão B |
| D — Falha tardia | HTTP 503 e falha de rede em cada fase; erro antigo não aparece na sessão atual |
| E — Sessão preservada | sucesso e rejeição definitiva na sessão original para cadastro, edição e exclusão; mensagens/reset/botões mantidos |
| F — Reentrada | mesmo UUID com nova geração; 27 cenários novos descartam resposta/erro da sessão anterior |

Validação local executada novamente: **234/234 testes aprovados**, sem skips ou remoção dos 207 anteriores; os quatro comandos `node --check` solicitados e `git diff --check` aprovados. O novo commit altera somente testes e os dois documentos; produção mantém os mecanismos de autenticação, investigação e transferência já revisados. Nenhum endpoint fiscal, dependência, banco, RLS ou configuração externa foi alterado.

**CI:** em 12/11, os runs antigos `43095997268` e `43095997273` de `fc4ffa3` ainda estavam `queued`, sem jobs/conclusão, com timestamps de criação/atualização em 11/11. Isso não constitui aprovação nem falha de teste. Os novos runs serão vinculados ao novo SHA no comentário de entrega; conferir seus estados reais antes de aprovar. Não alterar workflows para contornar a fila e não confundir checks de `8304706` com os do novo head.

Riscos e limites permanecem: descartar continuações não desfaz escrita já aceita, resultados incertos podem exigir conferência pela conta original, e transferências têm timeout finito. Testes reais Supabase A/B/C/D, isolamento REST/Storage, Auth URLs e recuperação/SMTP **não foram executados nesta conferência e continuam pendentes**. Etapa 01 parcialmente bloqueada; sem merge, deploy ou etapa 02. O GPT-6 deve revisar o novo diff, repetir os comandos de validação e conferir o SHA/conclusão dos dois Actions antes de decidir próximos passos.


## Validação Supabase real — 12/11/2026

Relatório e roteiro completo: [RADAR_JURIDICO_SUPABASE_VALIDATION.md](RADAR_JURIDICO_SUPABASE_VALIDATION.md). Código `7af09d0` reconferido, com 234/234 testes locais e os dois Actions aprovados. Produção não foi alterada.

Inspeção de catálogo real confirmou RLS/ACL das sete tabelas, políticas por proprietário/autorização ativa, FKs compostas, bucket privado de 10 MB e triggers de auditoria protegidos. Sete GETs REST anônimos com `limit=0` retornaram HTTP 401 / PostgreSQL `42501`, sem retornar linhas. Isso comprova bloqueio anônimo, **não** isolamento autenticado A/B/C/D.

Dois critérios de configuração foram classificados REPROVADOS: endpoint público Auth anuncia `disable_signup=false` (contraria cadastro fechado exigido no setup) e Security Advisors mantém WARN de proteção de senhas vazadas desativada. Não foi tentado cadastro nem alterada configuração; não foi demonstrado acesso indevido a dados. Revisão/correção administrativa pendente, sem contratar plano pago automaticamente.

O usuário confirmou ausência de ambiente isolado e contas sintéticas preparadas. Login/CRUD autenticado, isolamento real REST/Storage, revogação, URLs Auth e recuperação/SMTP permanecem BLOQUEADOS. Não houve criação de contas, escrita de fixtures, upload ou envio de e-mail. Roteiro A/B/C/D e matriz por tabela/operação/Storage prontos para execução autorizada, sem service_role ou impersonação. Nenhum teste simulado foi rotulado como real. Etapa 01 parcialmente bloqueada, sem merge/deploy ou etapa 02.


## Missão 01.5 — segurança administrada e plano de testes

[Análise detalhada e plano local](RADAR_JURIDICO_SUPABASE_VALIDATION.md#missão-015--decisões-administrativas-e-laboratório-r-0), em 12/11/2026. Signup aberto reconfirmado; caminho exato para o administrador: Authentication → Sign In / Providers → Allow new users to sign up (desativar após autorização), mantendo Email ativo. Login existente deve continuar; recovery e convite usam fluxos separados, mas a comprovação real após a mudança permanece bloqueada.

Plano **Free** confirmado por metadados da organização. Documentação oficial limita leaked password protection a **Pro ou superior**: não há ativação gerenciada gratuita a executar. Aviso persiste como risco/decisão, com alternativas sem contratação propostas; nenhuma configuração, exigência adicional de senha/MFA ou conta foi alterada.

Docker Engine disponível; CLI Supabase ausente. Plano de stack local + Mailpit + esquema/RLS sem dados de produção descrito, sem instalação/inicialização/provisionamento. A whitelist do servidor não aceita Supabase HTTP local: E2E de portal exige harness loopback separado/revisado ou ambiente hospedado autorizado, sem enfraquecer produção. Nenhum desses recursos foi criado. A/B/C/D e E2E reais seguem BLOQUEADOS.

234/234 testes e quatro checks de sintaxe novamente aprovados; runtime/dependências preservados, custo contratado adicional R$ 0. PR apto à revisão e próxima preparação autorizada, não à publicação. Aguardar autorização específica do titular para signup/laboratório e revisão do GPT-6; etapa 01 parcialmente bloqueada, sem merge/deploy/missão 02.


## Missão 01.6 — execução autorizada, bloqueada por infraestrutura

O proprietário autorizou laboratório local, ferramentas/fixtures sintéticas e fechamento exclusivo de signup. A tentativa conferiu Docker 29.9.2 e baixou/extraiu CLI oficial v3.1.0 no workspace. A CLI falhou com EROFS ao inicializar diretório pessoal; durante investigação, o executor desconectou e o ambiente foi marcado unavailable. A chamada posterior confirmou ausência de executor utilizável; metadados de status contraditórios não foram tomados como recuperação. Nenhum container/conta/registro/objeto foi criado.

[Relato detalhado, matriz e evidências](RADAR_JURIDICO_SUPABASE_VALIDATION.md#missão-016--tentativa-de-execução-e-indisponibilidade-do-executor). Auth/RLS/Storage/recuperação/harness e comandos locais de regressão desta missão estão BLOQUEADOS, não aprovados. Os 234 testes anteriores permanecem preservados e históricos; somente os Actions remotos do novo head, se concluídos, são evidência nova de regressão.

Signup não foi alterado porque a ferramenta administrativa compatível não está disponível; autorização já existe. Administrador deve desativar somente Allow new users to sign up no painel Auth/Providers, mantendo Email e demais opções, e conferir antes/depois. Última leitura anterior: disable_signup=false; não reconfirmada nesta missão. Produção, código, whitelist/CSP, usuários e RLS não foram alterados. Sem merge/deploy ou missão 02; retomada depende de executor utilizável, não de nova autorização.
