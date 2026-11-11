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
| `npm test` após revisão GPT-6 | 135/135 aprovados: todos os 83 anteriores + 52 cenários novos de sessão/transferências |
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
