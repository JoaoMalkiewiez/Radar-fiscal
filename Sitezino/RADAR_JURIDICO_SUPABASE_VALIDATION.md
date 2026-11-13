# Missão 01 — validação real de segurança e Supabase

Data: **12/11/2026**. Código aprovado e testado: `7af09d035010d78d9bc44b9b502a015980d54464`. Projeto: `kokpxikvisheaxkicmop`. Mesmo PR #12 e branch `fix/juridico-auth-session-security`.

**Conclusão: etapa 01 parcialmente BLOQUEADA; publicação não recomendada nesta validação.** O usuário confirmou que ainda não há ambiente isolado nem quatro contas sintéticas preparadas. Não criamos contas, não alteramos usuários, autorização, configurações, schema ou RLS; não enviamos e-mails nem escrevemos registros/arquivos. Não foi usada `service_role`, impersonação SQL, JWT fabricado ou sessão de cliente existente. Nenhum dado real foi consultado.

O código aprovado permanece intacto. Esta entrega documenta a inspeção e prepara a execução dos testes bloqueados; não apresenta simulações como E2E real.

## Ambiente e método

- Workspace local: Node `v24.22.1`, código do SHA acima; `npm test` com HTTP/DOM sintéticos e execução dos quatro `node --check` solicitados.
- GitHub Actions do SHA aprovado: [Validate Radar Fiscal, 43218220244](https://github.com/JoaoMalkiewiez/Radar-fiscal/actions/runs/43218220244) e [Radar Juridico, 43218219928](https://github.com/JoaoMalkiewiez/Radar-fiscal/actions/runs/43218219928), ambos `success`, reconfirmados.
- Supabase real: MCP usado **somente para SELECT de catálogo/configuração do bucket** e Security Advisors. Não foram lidas linhas de `auth.users`, `legal_access`, tabelas de clientes ou objetos privados.
- HTTP real: GET da configuração pública do portal; somente chave **publicável** em memória, sem impressão/persistência. Confirmado destino exato do projeto antes de enviar a chave por header `apikey`. GET nas sete tabelas com `limit=0`, sem JWT de usuário. GET em `/auth/v1/settings`. Sem tokens em URLs, retries automáticos ou operações mutantes; redirects não foram seguidos.
- O site publicado não contém necessariamente o head deste PR: sem deploy, o smoke de produção não demonstra execução desse commit. SQL de catálogo verifica definições; não prova comportamento com tokens A/B/C/D.

## Classificação

**APROVADO:** critério específico efetivamente verificado, com o alcance indicado. **REPROVADO:** critério específico não atendido pela evidência disponível. **BLOQUEADO:** falta pré-requisito para executar. **NÃO EXECUTADO:** deliberadamente não realizado, sem resultado presumido.

### Matriz executada

| ID | Cenário e ambiente | Estado | Evidência sanitizada e limite |
| --- | --- | --- | --- |
| AUTO-01 | Suíte automatizada local | APROVADO | **234/234**, zero falhas/skip; inclui Auth, sessões, CRUD, CNPJ/CPF/SEFAZ/DataJud/SNCR. Simulações locais, não E2E Supabase |
| AUTO-02 | Sintaxe | APROVADO | `juridico-portal.js`, `juridico-investigacao.js`, `test/juridico-auth.test.js`, `test/server.test.js` |
| CI-01 | Dois Actions do código aprovado | APROVADO | Ambos `completed/success` em `7af09d0`; links acima |
| META-01 | RLS e ACL das sete tabelas | APROVADO | `relrowsecurity=true`; anon sem SELECT/INSERT/UPDATE/DELETE em todas; definição real, sem exercício de escrita |
| META-02 | Políticas dos cinco módulos e auditoria | APROVADO | Proprietário `auth.uid()` e existência de autorização ativa; tabelas operacionais têm USING/WITH CHECK; não comprova isolamento executado A/B |
| META-03 | `legal_access` | APROVADO | SELECT somente do próprio `user_id`; authenticated sem INSERT/UPDATE/DELETE; role não usa user_metadata |
| META-04 | Referências cruzadas | APROVADO | FKs compostas `(client_id, owner_id)` e `(case_id, owner_id)`; documento exige pasta do proprietário. Definições, não tentativas reais |
| META-05 | Bucket e políticas Storage | APROVADO | `legal-private`, `public=false`, limite **10485760 bytes**; PDF/PNG/JPEG/DOCX; SELECT/INSERT/DELETE exigem pasta do usuário e autorização ativa. Sem teste de transferência |
| META-06 | Auditoria | APROVADO | Cinco triggers habilitados; função em `legal_internal`, SECURITY DEFINER com search_path vazio e EXECUTE negado a anon/authenticated. Auditoria somente SELECT para authenticated com RLS; sem eventos reais criados |
| HTTP-01 | Configuração pública do portal | APROVADO | HTTP 200, URL igual ao projeto esperado e formato `sb_publishable_*`; não verifica Site URL/Redirect URLs |
| HTTP-02 | SELECT anônimo real nas sete tabelas | APROVADO | **7/7 recusados: HTTP 401, código PostgreSQL `42501`**, usando `limit=0`; nenhuma linha solicitada/retornada. Demonstra bloqueio por permissão, não isolamento de usuários autenticados |
| CFG-01 | Cadastro fechado, exigido no setup | REPROVADO | `/auth/v1/settings`: HTTP 200, **`disable_signup=false`**, provedor e-mail ativo. Não foi tentado signup; configuração anunciada contradiz o guia |
| CFG-02 | Proteção contra senhas vazadas | REPROVADO | Security Advisor WARN `auth_leaked_password_protection`: desativada. Não é prova de senha fraca existente ou exploração; nenhuma senha consultada |

### Evidência HTTP-02 por tabela

Todas as consultas foram `GET /rest/v1/<tabela>?select=<identificador>&limit=0`, somente com chave publicável, sem Authorization de usuário.

| Tabela | Identificador | HTTP | Código | Estado |
| --- | --- | --- | --- | --- |
| legal_clients | id | 401 | 42501 | APROVADO |
| legal_cases | id | 401 | 42501 | APROVADO |
| legal_events | id | 401 | 42501 | APROVADO |
| legal_documents | id | 401 | 42501 | APROVADO |
| legal_movements | id | 401 | 42501 | APROVADO |
| legal_access | user_id | 401 | 42501 | APROVADO |
| legal_audit_logs | id | 401 | 42501 | APROVADO |

Outros campos públicos Auth observados: `mailer_autoconfirm=false`, `phone_autoconfirm=false`, provedor email ativo. Isso não comprova entrega SMTP, URLs de retorno, MFA ou configuração completa de autenticação.

### Matriz real bloqueada/não executada

| ID | Cenário | Estado | Motivo/pré-requisito |
| --- | --- | --- | --- |
| AUTH-A | A: login, dashboard, dados próprios, CRUD, logout/reentrada | BLOQUEADO | Conta sintética autorizada e ambiente isolado não preparados |
| AUTH-B | B: login, CRUD próprio e isolamento em relação a A | BLOQUEADO | Duas contas sintéticas com JWTs comuns e fixtures conhecidas inexistentes |
| AUTH-C | C: login válido, UI e operações privadas sem `legal_access` | BLOQUEADO | Conta sintética sem autorização não disponível |
| AUTH-D | D: login válido desativado e revogação com sessão aberta | BLOQUEADO | Conta dedicada criada para teste e intervenção administrativa especificamente autorizada não disponíveis |
| AUTH-TOKEN | Refresh real, expiração, logout remoto e revogação | BLOQUEADO | Sem sessão de teste real; não usamos sessão de conta existente |
| DB-01 | S/I/U/D nas cinco tabelas operacionais, vínculos e owner falsificado | BLOQUEADO | Sem ambiente/contas/fixtures; definições de RLS não substituem execução |
| DB-02 | SELECT próprio e escrita negada em legal_access/audit, isolamento da auditoria | BLOQUEADO | Faltam JWTs sintéticos e eventos produzidos por fixtures |
| ST-01 | Upload/download/listagem/exclusão próprios e cruzados | BLOQUEADO | Sem JWTs/objeto sintético existente; 404 de objeto inexistente não provaria isolamento |
| ST-02 | MIME permitido/negado, tamanho exato 10 MB e acima | BLOQUEADO | Sem ambiente isolado; limite inspecionado, não exercitado por HTTP |
| MAIL-01 | Site URL e Redirect URLs no dashboard | BLOQUEADO | Ferramentas atuais não expõem essas configurações; sem sessão segura de operador no dashboard |
| MAIL-02 | Convite, link expirado, recuperação, redefinição e login posterior | BLOQUEADO | Sem contas/caixa postal controlada e autorização/configuração SMTP de teste |
| MAIL-03 | Provocar HTTP 429 real por envios repetidos | NÃO EXECUTADO | Não esgotar nem contornar cotas. Tratamento local simulado aprovado; resposta real desta execução não obtida |
| NET-01 | Interromper rede durante sessão/gravação/transferência real | BLOQUEADO | Exige ambiente isolado e fixture; testes determinísticos locais permanecem aprovados |
| LGPD-01 | Revisar logs reais de usuários/documentos | NÃO EXECUTADO | Não ler registros confidenciais; fonte/fixtures e evidências sanitizadas bastam para esta fase |
| OPS-01 | Backup/restauração e teste de carga | NÃO EXECUTADO | Fora da execução autorizada atual; não gerar custos ou operações em produção |

## Achados, correções necessárias e risco residual

1. **Cadastro aberto anunciado pelo Auth (CFG-01).** O guia exige cadastro fechado. Um administrador deve revisar a configuração e decidir a correção mediante autorização explícita. Não tentamos criar conta nem alteramos `disable_signup`. Mesmo uma conta autenticada continua dependendo de `legal_access.enabled=true` nas políticas inspecionadas; não foi demonstrado acesso indevido a dados. A configuração aberta não deve ser confundida com autorização automática ao escritório.
2. **Proteção de senhas vazadas desativada (CFG-02).** [Remediação oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Conferir disponibilidade no plano atual; não habilitar serviço pago automaticamente. Decisão/configuração do operador pendente.
3. **Falta a prova comportamental com JWTs reais e fixtures.** Não houve defeito novo de código reproduzido nesta execução. Não há motivo para refazer o runtime aprovado; não alteramos políticas para fazer testes passarem.
4. **Operações e privacidade:** isolamento por conta é o modelo atual; não presumir compartilhamento entre advogados. JWTs já emitidos podem continuar válidos até expirar; testar autorização desativada em REST/Storage com sessão antiga. Callback descartado não desfaz escrita aceita pelo servidor. Limites de envio e transferência continuam dependentes do provedor/rede. Metadados de catálogo não comprovam ausência de exposição em todas as rotas nem garantem restauração de backup.

## Roteiro preparado para execução autorizada

**Ainda não executado.** O operador deve registrar projeto/ambiente, SHA, instante, IDs das fixtures e as permissões de teste aprovadas antes de qualquer escrita. Usar projeto isolado com as mesmas migrações/políticas e Auth URLs controladas; obter decisão separada antes de qualquer teste mutante em produção. Não contratar serviços, criar nova infraestrutura ou mudar configurações automaticamente.

### Pré-requisitos e proteção dos dados

1. Disponibilizar quatro contas novas **exclusivas desta execução**, via mecanismo administrativo aprovado. A/B com `legal_access.enabled=true`; C sem linha em legal_access; D inicialmente desativada. Não reutilizar nem modificar contas existentes. O subteste de revogação exige uma fixture D criada exclusivamente para ele, com sequência de autorização aprovada; se isso não for permitido, manter o subteste BLOQUEADO.
2. Usar caixa postal controlada pelo operador para o fluxo de e-mails; não inventar e-mail real nem usar terceiros. Guardar credenciais somente nas configurações seguras do ambiente, nunca em chat, Git, fixtures versionadas, URLs, comandos literais ou logs. Não iniciar coleta de HAR/screenshots de links Auth sem sanitização.
3. Identificar o lote por `run_id` aleatório e gerar UUIDs de fixture no cliente. Manter manifesto privado em memória com pseudônimo A/B/C/D e UUIDs criados. Não listar tabelas inteiras: filtrar por UUIDs do manifesto e, quando aplicável, owner da conta sintética.
4. Nome de cliente: `E2E Radar Jurídico <run_id>/A`; `kind=pf`, `document/email/phone=null`. Processo e compromisso com títulos sintéticos, CNJ nulo, datas explícitas em ISO; movimentação vinculada somente ao processo de fixture. Sem CPF ou nome de pessoa real. Arquivo gerado localmente, sem conteúdo confidencial; caminhos `<uuid-do-proprietário>/e2e-<run_id>-<uuid>.pdf`.
5. Requisições de usuário comum: chave **publicável** no header apikey e access token recebido do login no header Authorization. Nunca service_role, chave secreta, SET ROLE ou JWT fabricado. Tokens/refresh tokens somente em memória. Cliente deve recusar redirects ao enviar credenciais e não fazer retry de gravação incerta.

### Autenticação, sessão e autorização

- Fazer login A/B/C/D via `POST /auth/v1/token?grant_type=password`, com credenciais sintéticas em corpo JSON, sem registrar corpo/resposta. Confirmar usuário esperado e `expires_in` válido antes de continuar.
- No portal local do SHA aprovado, com conexão autorizada ao ambiente de teste, confirmar A/B no dashboard. C/D devem ficar fora do workspace e não disparar carregamento das tabelas operacionais. Testar também REST/Storage diretamente para excluir a dependência da UI.
- **Exceção intencional:** legal_access permite a cada conta ler apenas sua própria autorização, inclusive `enabled=false`; C pode receber `[]` e D sua linha desativada. Não reprovar esse SELECT necessário ao gate da UI. Nenhum deles pode gravar autorização ou ler dados operacionais/auditoria/arquivos privados.
- Testar refresh pelo endpoint com refresh token legítimo; confirmar identidade preservada e rotação, sem imprimir tokens. Aguardar expiração controlada no ambiente isolado sem alterar a configuração de produção, confirmar renovação/expiração e um único retry de 401. Testar refresh inválido com token da própria fixture, logout e reentrada A com nova geração, além de A→logout→B com resposta pendente.
- Revogação: somente a autorização da fixture D dedicada pode mudar, por operador autorizado, após uma sessão sintética ter iniciado. A mesma sessão deve perder acesso às tabelas operacionais, auditoria e objetos. Registrar se houve também revogação no Auth; não presumir que o JWT é invalidado imediatamente.

### Matriz de banco a executar com JWTs A/B/C/D

| Tabela | Operação própria positiva | Negativas e invariantes |
| --- | --- | --- |
| legal_clients | A/B criam, leem, editam e apagam apenas fixtures próprias | B não lê/altera/apaga UUID de A; INSERT/UPDATE de owner=A usando B negado; C/D sem operações de dados |
| legal_cases | CRUD próprio com cliente próprio | B não vincula client_id=A com owner=B; não muda owner para A; cruzamento e C/D negados |
| legal_events | CRUD próprio com processo próprio | Processo de A não pode ser vinculado a evento de B; owner e acesso cruzados protegidos |
| legal_movements | CRUD próprio com case_id obrigatório da fixture | FK composta impede movimentação B com processo A; owner e acesso cruzados protegidos |
| legal_documents | CRUD de metadados sintéticos após objeto próprio | case_id e storage_path de A não podem ser usados por B; não excluir metadados/objeto de A |
| legal_access | SELECT da própria linha, conforme estado | SELECT de outra conta sem linha visível; INSERT/UPDATE/DELETE pelo usuário comum negados; nenhuma elevação de role/enabled |
| legal_audit_logs | A/B leem eventos próprios dos CRUDs de fixture | Sem eventos alheios; INSERT/UPDATE/DELETE comuns negados; actor/owner/entidade corretos; nenhum nome/CPF/conteúdo copiado |

Para mutações, usar `Prefer: return=representation`, filtro por UUID conhecido e verificar quantidade de linhas, não somente HTTP. Em cada negativa, fazer a operação positiva equivalente primeiro com o proprietário e confirmar depois que o registro original continua íntegro. SELECT/UPDATE/DELETE de linha invisível por RLS podem retornar **200 com `[]` ou zero linhas**, em vez de 403; isso é bloqueio se a conta A comprova que seu registro permanece intacto. INSERT/owner forjado deve falhar; referência cruzada pode ser recusada por FK (`23503`) ou RLS (`42501`). Não aceitar teste com payload inválido como prova de isolamento: validar os campos pela operação positiva de controle.

### Matriz Storage a executar com objetos existentes de fixture

- A/B enviam arquivo próprio, listam seu prefixo, baixam e comparam hash/tamanho local; A confirma existência antes das tentativas de B/C/D.
- B/C/D tentam baixar, listar e excluir o **mesmo caminho conhecido de A**. Não registrar bytes. Listagem `[]`, objeto oculto 404 ou exclusão sem efeito podem ser formas legítimas de negação; depois A deve conseguir baixar o objeto inalterado. Um 404 em caminho aleatório/inexistente não é prova de isolamento.
- B tenta upload na pasta A e link de metadados com pasta/owner alheios; deve falhar sem alterar fixture A. Testar URL pública de objeto conhecido: bucket privado não deve servir os bytes sem autorização. Não gerar signed URLs públicas duradouras.
- Com a conta autorizada, exercitar PDF/PNG/JPEG/DOCX permitidos, MIME não permitido (`text/plain`), exatamente 10485760 bytes e 10485761 bytes, além de limites de metadados. Conferir o objeto depois da recusa; não presumir proteção por extensão ou antivírus, que não foram comprovados.
- Confirmar exclusão própria de objeto e metadados, tentativa cruzada sem efeito e auditoria dos metadados. Upsert/UPDATE de objetos não é funcionalidade do portal atual; não adicionar política para habilitá-lo durante este teste.
- Em rede interrompida após escrita, registrar resultado incerto e conferir por UUID/chave da fixture antes de repetir. Não reenviar automaticamente, apagar um objeto confirmado após perda de resposta dos metadados ou executar limpeza usando sessão diferente.

### Recuperação e URLs

Operador confere Site URL e Redirect URLs, sem colar segredos, incluindo exatamente `https://radar-fiscal-iyn3.onrender.com/juridico/portal` como retorno de produção; em laboratório, aprovar também o retorno do host local do commit testado, sem mudar produção por iniciativa do teste. Solicitar **um** convite/recuperação por subcaso para caixa controlada; observar callback, remoção do fragmento, definição da senha e login posterior. Testar link expirado/reutilizado com fixture, retorno arbitrário rejeitado, falha de rede e logout/revogação. Capturar somente status/tipo de evento; não URL contendo token nem corpo da resposta Auth.

Se 429 ocorrer legitimamente, registrar status e Retry-After sem repetir envio; não fabricar quota esgotada como resposta real nem prometer horário de liberação. Falha induzida no cliente e 429 simulado podem continuar sendo usados para regressão, rotulados como simulação. Ausência de SMTP/dashboard/caixa controlada mantém o subcaso BLOQUEADO.

### Evidências e limpeza

Registrar para cada ID: estado, ambiente, SHA, instante, ator pseudônimo, UUID de fixture, operação, HTTP/SQLSTATE, número de linhas e hash dos bytes sintéticos quando necessário. Nunca senha, token, headers de autorização, corpo de arquivo, e-mail pessoal ou resposta bruta do provedor. Screenshots/console/HAR só depois de sanitizar URLs e conteúdo.

Limpar somente UUIDs/chaves do manifesto: documentos/objetos, movimentações, eventos, processos e clientes em ordem compatível com FKs. Verificar que não restaram objetos/fixtures; preservação de auditoria depende da retenção aprovada — não apagar auditoria nem usuários para ocultar evidência. Se não existir procedimento autorizado de limpeza/retenção, bloquear a criação das fixtures. Não usar DELETE amplo, truncate ou cascata em conta existente.

## Recomendação para revisão/publicação

Manter PR #12 em draft e etapa 01 parcialmente bloqueada. O operador precisa disponibilizar ambiente/contas sintéticas, decidir as configurações CFG-01/CFG-02 sem custos adicionais e executar a matriz real. Somente depois o GPT-6 pode revisar evidências e decidir sobre publicação. **Este relatório não autoriza merge/deploy nem missão 02.**

## Missão 01.5 — decisões administrativas e laboratório R$ 0

Conferência de **12/11/2026**, base `0c3a579`. Nenhuma configuração foi aplicada. Esta seção complementa a matriz anterior, sem alterar o código aprovado ou converter testes bloqueados em aprovações.

### Estado novamente observado e disponibilidade das ferramentas

- GET real `/auth/v1/settings`: HTTP 200, `disable_signup=false`, `mailer_autoconfirm=false`, email ativo. Nenhum signup/login/convite/recovery foi tentado.
- Security Advisor: mantém WARN `auth_leaked_password_protection`.
- Metadados da organização do projeto confirmam **`plan=free`, `tier=tier_free`**. Não foram consultados pagamentos, contas de usuário ou dados de clientes.
- As ferramentas Supabase conectadas não oferecem ação para atualizar a configuração Auth. Não usar SQL sobre schemas internos para substituir esse controle. Além disso, **não há autorização explícita para alterar produção**, mesmo se outro mecanismo vier a ficar disponível.
- Docker Engine local responde, versão `29.9.2`; executável Supabase CLI não localizado. Não houve instalação, criação/inicialização de containers, projeto, branch Supabase, conta ou outro recurso.
- `npm test` novamente: **234/234 aprovados**, zero falhas/skip. Os quatro `node --check` solicitados passaram. Custos contratados e alterações de runtime: **nenhum**.

### Cadastro fechado — ação concreta para o administrador

1. Abrir [projeto → Authentication → Sign In / Providers](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/providers).
2. Em **User Signups**, localizar **Allow new users to sign up** e, **após autorização explícita da mudança**, desativar e salvar. O resultado esperado é `disable_signup=true` no endpoint público. Não desabilitar o provedor **Email**: isso é outra configuração e pode interromper autenticação.
3. Não alterar simultaneamente confirmação de e-mail, URLs, SMTP, sessões, MFA, políticas de senha ou usuários. Registrar o estado anterior e a alteração específica, sem anexar segredos. Alteração não executada nesta missão.
4. Reconsultar `GET <url-do-projeto>/auth/v1/settings`, usando somente chave publicável no header apikey e descartando redirects. Registrar apenas HTTP e `disable_signup`, `external.email` e `mailer_autoconfirm`; nunca chave/headers. Esperado: signup desabilitado, email ainda ativo e demais opções preservadas.
5. Em ambiente autorizado, executar controles positivos de login e recovery de uma conta sintética existente e convite administrativo de uma conta **nova** dedicada. Testar signup público negativo somente com fixture e autorização, sem repetir envios. Não usar contas reais para verificar a mudança.

**Impacto esperado, documentado; ainda não testado em produção:** a [configuração geral oficial](https://supabase.com/docs/guides/auth/general-configuration) diz que, com signup desativado, usuários existentes continuam podendo entrar. Fechar cadastro não apaga contas, não muda senhas, não revoga sessões existentes e não substitui `legal_access`. Recuperação de conta existente é um fluxo separado de signup. A rota administrativa de convite também é separada; o fluxo upstream de `Invite` cria a conta pelo mecanismo administrativo, sem o gate público de `DisableSignup`. Convites continuam sujeitos a SMTP, limites e hooks de criação. Isso não garante entrega nem comprova o comportamento da versão hospedada sem o teste real.

Para o administrador, o fluxo de convite fica em [Authentication → Users](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/users), **Add user → Send invitation**, ou pela [API administrativa inviteUserByEmail](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail) em contexto administrativo seguro. Não colocar chave administrativa no portal ou usá-la nas verificações RLS de usuários comuns. Após aceitar convite, a conta só acessa o escritório se autorizada em `legal_access`.

Verificar separadamente [Authentication → URL Configuration](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/url-configuration): retorno explícito `https://radar-fiscal-iyn3.onrender.com/juridico/portal`, sem URL arbitrária/wildcard desnecessário. Convite deve usar o retorno do portal; o fallback depende de Site URL. Não modificar URLs como efeito colateral de fechar cadastro. Recovery, SMTP e redirecionamento real permanecem BLOQUEADOS.

A análise de implementação upstream consultou [invite.go](https://github.com/supabase/auth/blob/master/internal/api/invite.go), [recover.go](https://github.com/supabase/auth/blob/master/internal/api/recover.go) e [signup.go](https://github.com/supabase/auth/blob/master/internal/api/signup.go) em 12/11. É referência técnica, não identificação da versão hospedada nem evidência E2E. `Recover` procura a conta existente; o gate `DisableSignup` pertence ao fluxo público de cadastro. Nenhuma dessas rotas foi chamada com credenciais nesta análise.

### Senhas vazadas — Free versus Pro e alternativas

A [documentação oficial de Password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), consultada em 12/11, declara: **“Leaked password protection is available on the Pro Plan and above.”** Com o plano Free confirmado, a ativação gerenciada gratuita está **BLOQUEADA por disponibilidade do plano**. O aviso de proteção ausente permanece um risco; não é correto recomendar que o administrador simplesmente habilite a opção no Free ou afirmar que esta missão o eliminou.

Se o plano mudar por decisão separada do titular, a opção fica em **Authentication → Sign In / Providers → Email**, nas opções de segurança de senha. Não fazer upgrade nem habilitar recurso pago automaticamente. Não estimamos preço porque não há contratação proposta/autorizada; manter custo incremental contratado **R$ 0**.

O mecanismo rejeita senhas conhecidas como vazadas ao definir/alterar senha e pode impactar erros de credenciais fracas. Políticas fortalecidas não devem ser tratadas como migração automática das senhas atuais: conferir login existente, recovery e redefinição em laboratório. Não reescrever ou invalidar contas em massa. Não habilitar nonce/reauthentication, exigência de senha atual ou MFA como efeito colateral: esses controles exigem validação dos fluxos do cliente, particularmente a recuperação, que hoje não solicita todos esses campos.

Alternativas de custo de serviço zero, propostas e **não aplicadas**:

- Administrador revisar no provedor Email o mínimo/complexidade de senha; alinhar o backend ao mínimo de 12 caracteres já usado no formulário, após autorização e teste. O mínimo real do backend não foi inferido do formulário nem exposto pelo endpoint público consultado.
- Usar senhas longas, aleatórias e exclusivas, geradas/guardadas por gestor já disponível ao titular, sem contratar serviço. Não reutilizar senhas entre contas/ambientes.
- Fechar signup, manter confirmação de email e convite administrativo, não alterar cotas para contornar limites; preservar RLS por proprietário/autorização, higiene de sessão e proteção dos segredos existentes.
- Avaliar MFA em revisão própria apenas se houver disponibilidade sem custo e suporte integral do portal; não declarar MFA implementado ou impor um fator que impeça login/recovery.

Essas medidas **não equivalem** a detectar senhas vazadas. Não enviar senha em texto puro, hashes ou consultas a um serviço externo pelo navegador para tentar substituir a função paga. Não introduzir hooks/serviços novos, integrações HIBP, dependências ou custos como atalho. A aceitação do risco residual deve ser explícita na revisão do GPT-6/titular.

### Laboratório local — plano sem provisionamento externo

Opção preferencial para o primeiro ciclo: stack Supabase local sobre **Docker Engine já existente**, seguindo o [guia oficial de desenvolvimento local](https://supabase.com/docs/guides/local-development/cli/getting-started). Sem projeto remoto, branch hospedada ou SMTP contratado. Isso usa CPU/RAM/disco/rede da máquina existente; confirmar capacidade e política/licença do runtime antes de iniciar, sem aumentar plano de hospedagem. Não é promessa de custo operacional absoluto zero em qualquer máquina; é ausência de nova assinatura/serviço contratado. Não recomendamos criar projeto Free remoto presumindo cota disponível.

**Passos para execução futura autorizada — não executados:**

1. Aprovar a criação do laboratório local e de suas quatro contas/fixtures. Confirmar disco/RAM disponíveis, acesso às imagens oficiais e portas loopback livres. Supabase CLI ainda precisa ser instalado por método oficial em diretório de laboratório, com versão registrada/fixada, sem adicionar dependências ao app. Consultar `supabase --help` e ajuda dos subcomandos da versão instalada antes de executar.
2. Usar diretório isolado, por exemplo `work/radar-juridico-lab`, fora das migrações de produção. `supabase init` cria configuração local; **não executar `supabase link`**, não fornecer URL/chave de produção, não fazer pull/export de dados e não selecionar o projeto hospedado nas operações locais.
3. Preparar a stack local e conferir seu escopo antes de `supabase start`. CLI pode imprimir credenciais na inicialização/status: executar em terminal reservado, não enviar saída bruta a chat, CI ou screenshots. Guardar segredos apenas no ambiente seguro do laboratório. Serviços limitados a loopback, sem túnel/exposição pública.
4. Reproduzir somente a estrutura em banco **novo e vazio**, na ordem: `database/radar-juridico.sql`, `database/authorized-access-and-movements.sql`, `database/private-audit-trail.sql`. Se usar migrações CLI, criar cada arquivo com `supabase migration new` e aplicar somente na instância local após conferir as flags da versão. Não reaplicar SQL em produção nem copiar registros reais. Comparar políticas/ACL/FKs/bucket/triggers por catálogo; registrar versões e diferenças de Auth/Postgres/Storage.
5. O guia atual apresenta API em `http://127.0.0.1:54321`, Studio em `:54323` e captura de email local **Mailpit em `:54324`**; confirmar as portas emitidas pela versão usada, sem registrar as chaves. Configurar Auth/redirects **somente locais**. E-mails fictícios terminam na caixa local, sem destinatário externo nem consumo de cota SMTP hospedada; links continuam sensíveis e devem ser sanitizados.
6. Criar A/B/C/D **apenas no laboratório aprovado** usando o mecanismo administrativo local. A/B autorizados, C sem legal_access e D desativado. Subcaso de revogação usa uma fixture D exclusiva, criada para a transição autorizado→desativado; nunca desativar conta existente fora desse laboratório. Usuários comuns autenticam por senha e JWTs reais locais; chave administrativa não representa A/B/C/D.
7. Executar a matriz detalhada deste relatório: controles positivos próprios, leitura/escrita/owner e vínculos cruzados, auditoria, Storage com objeto conhecido, MIME/tamanho, refresh/logout/reentrada, convite/recovery e revogação. Registrar como **teste real contra Supabase local**, não validação do Supabase hospedado. Não confundir a captura local de email com prova de entrega SMTP de produção.
8. Limpar apenas fixtures do manifesto e encerrar os containers locais conforme autorização, sem apagar auditoria de produção ou dados de terceiros. Reservar a decisão de retenção/remoção do volume local ao operador. Não implementar job de limpeza amplo.

**Limitação concreta para E2E do portal:** `server.js` aceita `LEGAL_SUPABASE_URL` apenas em `https://<ref>.supabase.co` e chave no formato publicável. A API local HTTP não passa por essa configuração; é esperado `/api/juridico/config` não habilitar a conexão local. Não é defeito novo de produção e não relaxamos whitelist/CSP. O laboratório pode testar Auth/REST/Storage diretamente. Para UI completa, preparar e revisar separadamente um **harness de teste loopback** que sirva os assets aprovados e faça proxy para a stack local, com configuração de conexão/CSP exclusiva do laboratório, sem simular respostas de Auth/dados. Isso é adaptação do ambiente, que deve ser documentada, e ainda não foi implementada/autorizada. Outra opção é projeto hospedado de teste já autorizado e comprovadamente dentro da cota gratuita; nenhum foi identificado ou criado. Enquanto esse requisito não for atendido, o E2E completo de UI segue BLOQUEADO.

### Matriz da Missão 01.5

| Cenário | Estado | Resultado/pendência |
| --- | --- | --- |
| Inspeção Auth pública e plano | APROVADO | HTTP 200; cadastro aberto reconfirmado; plano Free verificado |
| Cadastro fechado em produção | REPROVADO | `disable_signup=false`; ação específica do administrador descrita, sem autorização para aplicá-la |
| Preservação de login/recovery/convite após fechar signup | BLOQUEADO | Comportamento esperado/documentado; exige alteração autorizada e contas de fixture para comprovar |
| Advisor de senhas vazadas | APROVADO quanto à execução da inspeção | WARN continua; proteção não ativada |
| Ativação gerenciada sem custo no Free | BLOQUEADO | Docs reservam recurso a Pro+; nenhuma contratação |
| Preparação de plano local sem recurso externo | APROVADO quanto ao planejamento | Docker disponível, CLI ausente, migrações e limitação UI identificadas; nenhum laboratório criado |
| A/B/C/D, login/refresh/CRUD/RLS/Storage/recovery reais | BLOQUEADO | Sem ambiente/credenciais/contas novos autorizados; plano pronto, execução não iniciada |
| Alteração de produção, provisionamento e envios reais | NÃO EXECUTADO | Proibidos sem autorização específica; nenhum dado existente alterado |
| Automação local | APROVADO | 234/234 e quatro checks de sintaxe, sem remoção/skip |

**Próxima validação:** o PR permanece tecnicamente apto à revisão e preparação autorizada do laboratório, com runtime preservado; **não está liberado para produção nem permite concluir a etapa 01**. Administrador/titular precisa autorizar a mudança específica de signup e a criação do laboratório/fixtures, e decidir mitigação/aceitação do aviso pago. Seguem pendentes E2E A/B/C/D, URLs e entrega SMTP hospedada. Aguardar GPT-6, sem merge/deploy ou missão 02.


## Missão 01.6 — tentativa de execução e indisponibilidade do executor

Data: **12/11/2026**, base `38436d41324cbecf03157029f9da6ad256c1a994`. O proprietário **autorizou expressamente** laboratório local Docker/Mailpit, ferramentas gratuitas, contas/fixtures A/B/C/D locais e a alteração exclusiva de signup em produção. Esses itens não estão mais bloqueados por falta de autorização. Continuam proibidos merge/deploy, contas/RLS/dados de produção, contratação e missão 02.

### Execução realmente tentada

1. Branch específica e SHA de referência conferidos, workspace limpo; scripts SQL, testes e documentação inspecionados. Docker informou versão **29.9.2**, memória do daemon aproximadamente 10 GB; filesystem do workspace aproximadamente 7,5 GB livres. Apenas consultas de capacidade, sem criar/iniciar containers.
2. O release oficial mais recente consultado do Supabase CLI foi **v3.1.0**. O arquivo oficial Linux amd64 foi baixado e extraído em `work/bin`; criado diretório separado `work/radar-juridico-lab`. Não executamos `supabase link`, login na plataforma ou importação de dados.
3. A primeira invocação da CLI falhou antes de disponibilizar a ajuda/versão: **EROFS ao criar /home/agent/.supabase**. Trata-se da inicialização da ferramenta em filesystem somente de leitura, não falha do Radar Jurídico ou teste Supabase. Uma tentativa de apontar configuração para o diretório do laboratório com `SUPABASE_CONFIG_DIR` não eliminou o erro; não se presume que esse seja um override suportado pela v3.1.0.
4. Enquanto investigávamos a inicialização por código-fonte oficial, o executor desconectou: **executor key changed during session recovery**. O ambiente selecionado passou a **unavailable**. Uma consulta simples em diretório temporário confirmou **No usable execution environment is available**.
5. O conector de status ainda anunciou running/connected, em contradição com o contexto atual e a falha efetiva de execução. Não tratamos esse status como prova de recuperação. Diagnósticos retidos retornaram `history_status=not_found`, sem registros: isso também não estabelece a causa nem a saúde do executor. Nenhum log sensível de diagnóstico foi solicitado/compartilhado.
6. Solicitada reativação/anexação de ambiente com Docker. Conectores GitHub continuaram acessíveis, permitindo atualizar esta evidência na mesma branch. Não há recurso Supabase local em execução criado por esta tentativa. Não foi criado usuário, senha/token de fixture, registro ou objeto; portanto limpeza de fixtures não se aplica. Não se afirma persistência/remoção dos arquivos auxiliares após a perda do executor.

### Signup de produção — autorização concedida, ação administrativa indisponível

As ferramentas Supabase conectadas não expõem atualização da configuração Auth. Não usamos SQL interno, API de dados ou credenciais improvisadas para substituir o controle oficial. A exceção prevista na missão aplica-se: **somente esta etapa depende de ação manual no dashboard**. Nenhuma configuração foi alterada.

Procedimento já autorizado ao administrador: [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/providers) → User Signups → **Allow new users to sign up: OFF** → salvar. Manter Email ativo, confirmação de email, SMTP, URLs, sessões e todas as demais opções inalteradas. Conferir `disable_signup=true`, Email ativo e comparação das demais configurações antes/depois, sem compartilhar chaves. Não desativar contas existentes.

O último valor efetivamente observado foi `disable_signup=false` na missão 01.5. **Não houve nova leitura nem confirmação de alteração na missão 01.6** após a indisponibilidade do executor. Logo, não se declara cadastro fechado nem preservação real de login/recovery/convite comprovada.

### Matriz desta tentativa — sem resultados inventados

| Cenário | Estado | Evidência |
| --- | --- | --- |
| Conferência inicial do checkout/capacidade | APROVADO | Branch/SHA, Docker e espaço observados antes da falha |
| Download/extração da CLI oficial | APROVADO somente quanto ao download | Release v3.1.0; não equivale a stack pronta |
| Inicialização da CLI | REPROVADO como etapa técnica | EROFS em diretório pessoal, antes dos testes; não defeito do produto |
| Acesso posterior ao executor | BLOQUEADO | Ambiente unavailable; chamada simples sem executor utilizável |
| Fechar signup e conferir antes/depois | BLOQUEADO | Sem ferramenta administrativa compatível; procedimento manual fornecido, autorização não é o impedimento |
| Stack oficial, Mailpit, banco local e aplicação dos SQL | BLOQUEADO | CLI não iniciou; executor indisponível antes de iniciar stack |
| Contas A/B/C/D, Auth/refresh/expiração/convite/recovery reais | BLOQUEADO | Nenhuma conta criada ou sessão real de laboratório |
| RLS/CRUD/vínculos/revogação/auditoria reais | BLOQUEADO | Banco/fixtures inexistentes nesta execução |
| Storage, tipos/tamanho e integridade após negativas | BLOQUEADO | Sem stack/usuários/objetos de controle |
| Harness loopback e navegador desktop/mobile real | BLOQUEADO | Sem executor/stack; proteções de produção preservadas |
| `npm test` e quatro `node --check` locais nesta missão | BLOQUEADO | Não chegaram a ser executados; os 234 aprovados anteriores são históricos |
| Novos testes de laboratório | NÃO EXECUTADO | Nenhuma resposta simulada foi contada como teste real |
| Limpeza de usuários/objetos sintéticos | NÃO EXECUTADO / não aplicável | Nenhuma fixture criada |
| Merge/deploy/alteração de RLS ou dados de produção | NÃO EXECUTADO | Restrições integralmente preservadas |

O novo commit altera **somente os três documentos** e mantém os testes/código aprovados. Os Actions do novo SHA podem ser executados remotamente pelo GitHub; seus resultados serão registrados no comentário de entrega, separados dos testes locais bloqueados. Não transportar as aprovações do SHA anterior para este head sem conferir os runs.

### Retomada concreta

Reativar/anexar executor com Docker e workspace utilizável; confirmar os arquivos/recursos presentes antes de repetir instalações. Resolver a inicialização da CLI em um diretório gravável suportado pela versão, ou executá-la em ambiente de ferramenta isolado apropriado, sem redefinir HOME como atalho, mudar permissões globais ou presumir flags. Só então consultar a ajuda, inicializar stack oficial, restringir serviços a loopback, aplicar os SQL em banco vazio e executar a matriz real já definida, incluindo harness local separado. Não contornar restrições de rede ou fragilizar whitelist/CSP para obter testes verdes.

A autorização permanece válida; não é necessário solicitá-la novamente. Esta missão **não concluiu os testes reais obrigatórios**. Custo contratado adicional R$ 0, nenhum recurso externo criado. Etapa 01 parcialmente bloqueada e PR draft, sem publicação ou missão 02, aguardando ambiente utilizável e revisão GPT-6.

## Missão 01.7 — executor recuperado, EROFS resolvido, disco insuficiente

Data: **12/11/2026**, início em `1720b1a85fee1d5c18a305e77581f1708b7dd40e`, mesma branch e PR #12. Autorizações da missão 01.6 preservadas. Nenhuma alteração de runtime, dado, conta, política ou configuração de produção.

### Diagnóstico efetivamente executado

- Executor disponível; arquivo de prova criado/removido no workspace. Usuário UID 1000. Aproximadamente **9 GB de memória disponível**, Docker Engine **29.9.2** respondendo pelo socket local explicitamente selecionado, filesystem total **7,9 GB**, inicialmente **7,3 GB livres**. Não houve nova desconexão do executor nesta missão.
- Origem do EROFS: a CLI tenta manter estado global em `<home>/.supabase`, mas o diretório pessoal é somente de leitura neste ambiente. Inspeção do código oficial identificou o override **`SUPABASE_HOME`** em [supabase-home.ts, v3.1.0](https://github.com/supabase/cli/blob/v3.1.0/apps/cli/src/shared/config/supabase-home.ts) e sua leitura nas camadas de configuração.
- `SUPABASE_HOME=/workspace/work/radar-juridico-lab/.cli` resolveu a inicialização: **CLI 3.1.0 executou `--version`, `--help`, `init --help`, `init`, `start --help` e `status --help`**. Não redefinimos HOME/CODEX_HOME, não ampliamos permissões globais e não presumimos o antigo SUPABASE_CONFIG_DIR como opção válida. Telemetria desativada para o laboratório.
- Binário obtido do release oficial v3.1.0; SHA-256 comparado com o campo `digest` do asset no GitHub e confirmado. O asset separado checksums.txt retornou vazio nesta consulta; a verificação foi feita pelo digest oficial, não ignorada. Configuração local criada em diretório separado, com retorno loopback e JWT de 60 s para futura expiração real. Sem link/credenciais do projeto hospedado.

### Tentativa oficial e limite de capacidade

Executado `supabase start` excluindo realtime/imgproxy/postgres-meta/studio/edge-runtime/logflare/vector/supavisor. Permaneceram somente Postgres, Auth, REST, Storage, gateway e Mailpit. Saída bruta guardada em arquivo privado fora do Git, porque a inicialização pode imprimir segredos quando bem-sucedida.

O Docker usa **`vfs`**. A extração falhou no Storage: `failed to register layer ... no space left on device`. O `df` após falha voltou a mostrar espaço porque camadas temporárias são liberadas; isso não elimina o pico de consumo observado. A execução CLI foi interrompida antes de continuar repetindo pulls. Uma segunda estratégia controlada — pull **sequencial** do Postgres oficial `17.11.0.018` antes de Storage — também terminou com `no space left on device` ao expandir `/nix/store/...icu4c...`. O pull sequencial de Storage não chegou a ser executado, pois dependia do sucesso do Postgres.

Não repetimos a tentativa após a segunda falha, não alteramos driver/data-root do Docker, não fizemos prune global e não aumentamos plano. Verificação final: **zero containers e zero volumes**; quatro imagens menores permaneceram em cache (Auth, REST, Mailpit, Kong). Nenhuma stack saudável, usuário A/B/C/D, registro, objeto, sessão ou e-mail de laboratório foi criado. Limpeza de fixtures não se aplica. Os arquivos auxiliares/logs locais e cache de imagens não foram tratados como dados de produção nem enviados ao repositório.

**Requisito que falta:** capacidade de disco no armazenamento do Docker para a expansão das imagens oficiais. O executor está funcional e o bloqueio não é mais HOME/EROFS. O caminho reproduzível para Windows + Docker Desktop/WSL2, com recursos recomendados e ressalva de licença, está em [lab/README.md](lab/README.md). Recomenda-se reservar 30 GB livres como margem operacional, não como mínimo oficial/garantia para todo driver. Conferir também o disco virtual do Docker, não somente o diretório do checkout.

### Arquivos de laboratório preparados, ainda sem validação E2E

- `lab/README.md`: instalação fixada, digest oficial, diretório gravável suportado, init/start sem link, migrações, configuração privada, execução/limpeza e Windows/WSL2.
- `lab/configure-private.mjs`: lê status JSON privado da CLI e cria configuração privada exclusiva de loopback, sem imprimir chaves.
- `lab/validate-real.mjs`: runner inicial explícito para contas/fixtures locais, JWTs comuns, Auth/Mailpit, matriz REST/Storage, revogação, auditoria, expiração e limpeza pelo manifesto. Admin local é reservado a bootstrap/limpeza, não representa usuários nos testes RLS. **Não executado contra stack iniciada; payloads/compatibilidade/resultados ainda precisam ser validados.** Não há aprovação de testes reais apenas por existir o runner.
- `lab/portal-harness.mjs`: servidor/proxy real restrito a `127.0.0.1:5517`, serve assets aprovados e encaminha para Supabase local sem alterar whitelist/CSP do servidor de produção. Só aceita backend loopback e não devolve chave administrativa na configuração. **Não validado com Auth/Storage real nesta missão.**
- `test/lab-safety.test.js`: dois testes unitários de processo confirmam recusa de URL hospedada antes de requests/servidor. São testes de guarda, **não E2E**, sem resposta Supabase simulada usada como evidência real.

### Resultados e classificação da missão

| Cenário | Estado | Evidência |
| --- | --- | --- |
| Executor/escrita/Docker/memória | APROVADO | Diagnóstico direto, sem status presumido |
| Diretório gravável oficial e CLI | APROVADO | SUPABASE_HOME documentado no código oficial; CLI 3.1.0 e init executados |
| Integridade do binário | APROVADO | Digest SHA-256 do asset oficial corresponde ao arquivo |
| Iniciar stack oficial | BLOQUEADO | Duas estratégias falharam por falta de disco na expansão vfs; sem ignorar health checks |
| Auth/convite/recovery/refresh/expiração reais | BLOQUEADO | Nenhum Postgres/stack/conta local disponível |
| RLS/REST/CRUD/owners/FKs/revogação/auditoria reais | BLOQUEADO | Fixtures inexistentes; runner preparado mas não executado |
| Storage/upload/download/MIME/tamanho/isolamento reais | BLOQUEADO | Sem backend e objetos conhecidos de controle |
| Portal desktop/mobile com backend real | BLOQUEADO | Harness preparado; sem stack para validar integração |
| Regressão automatizada | APROVADO | **236/236**, incluindo os 234 anteriores e dois testes unitários da guarda local; zero falhas/skip |
| Sintaxe | APROVADO | Quatro JS solicitados, três novos MJS e novo teste de segurança |
| Cadastro público fechado | REPROVADO no critério, alteração BLOQUEADA | GET real continua `disable_signup=false`, Email ativo, `mailer_autoconfirm=false`; não alterado |
| Limpeza de fixtures | NÃO EXECUTADO / não aplicável | Zero fixtures, containers e volumes criados; cache de imagens mantido sem prune global |

GitHub Actions do novo SHA serão vinculados com seus estados reais no comentário de entrega. Os testes locais foram executados nesta missão; não transportamos o resultado histórico de 234 como se fosse um novo E2E. Código fiscal, dependências da aplicação e proteções de produção preservados.

### Signup de produção e próxima ação

Reconferência HTTP nesta missão: settings 200, `disable_signup=false`, `external.email=true`, `mailer_autoconfirm=false`. Ferramentas Supabase conectadas continuam sem ação de atualização Auth e não há `SUPABASE_ACCESS_TOKEN` de gestão disponível no ambiente (somente presença verificada, sem imprimir valores). Não improvisamos credencial nem usamos SQL interno. Autorização do proprietário já concedida; falta mecanismo administrativo autenticado compatível.

Procedimento manual oficial: [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/providers) → User Signups → **Allow new users to sign up OFF**, salvar mantendo **Email e todas as outras opções**. Comparar antes/depois e verificar `disable_signup=true` sem expor chaves. Não alterar SMTP, usuários, RLS ou URLs como efeito colateral. Nenhum login/convite/recovery de produção foi solicitado.

Retomar em host com disco suficiente, revisar/validar os runners ainda não exercitados e executar a matriz real antes de aprovar a etapa. Riscos residuais incluem compatibilidade do laboratório ainda desconhecida, signup aberto, proteção de senhas vazadas fora do Free, falta de prova real A/B/C/D/SMTP/URLs e resultados incertos de escrita. Nenhum serviço contratado; custo contratado adicional R$ 0. **PR continua draft e etapa 01 parcialmente bloqueada, sem merge/deploy/missão 02.**

## Missão 01.8 — revisão do laboratório sem repetição dos pulls

Data: **13/11/2026**. Base: `f0e6718d3946a36d18a8e1083db8f74824d8dabd`. Mesmo PR #12/branch. Autorizações anteriores preservadas; nenhuma nova autorização solicitada para ferramentas/fixtures locais ou signup específico. Runtime de produção não alterado.

### Fase A: capacidade atual e limite respeitado

Executor disponível e workspace gravável; Docker **29.9.2**, driver **vfs**, armazenamento `/home/dockerd/.local/share/docker`, filesystem **7,9 GB** com aproximadamente **3,5 GB livres**, memória disponível aproximadamente **9 GB**. CLI **3.1.0** continua inicializando com `SUPABASE_HOME` no workspace, sem alterar HOME/permissões globais. Não houve aumento comprovado de capacidade e **não foi feito novo pull, start, instalação da stack ou criação de container/volume**.

A margem operacional de aproximadamente 30 GB solicitada não foi atendida. Somente a execução da stack/E2E foi encerrada como bloqueada; a revisão de código de laboratório, correções, testes de regressão e documentação prosseguiram. [Procedimento executável Windows + WSL2/Docker Desktop ou Linux](lab/README.md) atualizado, mantendo validação de capacidade no armazenamento Docker, versão/digest da CLI, loopback, banco vazio e nenhuma conexão hospedada. Os comandos de Windows/WSL2 não foram executados neste host Linux e não constituem validação E2E.

### Fase B: defeitos identificados e correções comprovadas por testes

1. **Falso positivo em negativas:** o runner aceitava 400/401/403 genéricos como prova de RLS e até falhas genéricas em negativos de Storage. Agora exige SQLSTATE pertinente e status/código Storage compatível. Erros de payload, JWT ou indisponibilidade não comprovam bloqueio de acesso. Testes demonstram a rejeição desses falsos positivos; formatos reais da stack permanecem sujeitos ao E2E bloqueado.
2. **Integridade incompleta:** antes só comparava existência/proprietário de A e contagem nas mutações negadas C/D. Agora captura snapshot completo de A e compara todos os campos; C/D verificam a linha completa por SQL local, além dos bytes conhecidos do objeto. Não inferir integridade pelo HTTP 200.
3. **Limpeza sem confirmação:** a função antiga ignorava respostas das exclusões e marcava cleaned=true. Agora valida manifesto, UUIDs/proprietários/marcadores do lote e identidade da conta; confirma status e ausência de objetos, registros e usuários antes de declarar sucesso. Retorna falha se a API negar, objeto/usuário persistir ou identidade divergir. Conta criada sem resposta fica em pendingUsers e exige reconciliação, impedindo falsa declaração de limpeza. O resultado da fase cleanup não apaga reprovações históricas da suíte.
4. **Separação de chaves e arquivos:** o conversor/harness não rejeitavam uma chave administrativa trocada para o campo público. Agora distinguem chave publicável/anon de service_role e recusam troca/colisão; o teste de role é apenas uma barreira de configuração, não autenticação criptográfica. Arquivos privados são recusados dentro do repo, por symlink ou com caminhos colidentes; escrita privada mantém 0600. JSON corrompido não repete conteúdo potencialmente secreto no erro.
5. **Reentrada acidental no runner:** modo desconhecido anteriormente executava run. Agora setup/run/cleanup devem ser explícitos; falta de manifesto e repetição de rodada iniciada são bloqueadas antes de gravações. Setup exige Auth local vazio. Identificadores do lote são mantidos em nomes/caminhos para limpeza limitada.
6. **Rede e compatibilidade:** somente origens HTTP em 127.0.0.1, sem credenciais/caminho/query/fragmento na configuração; Mailpit não segue redirects, com timeout, e harness rejeita Location externo. Transferência usa 300 s e chamadas comuns 30 s. Leitura de erro Auth aceita error_code do REST GoTrue, sem confundir code HTTP numérico. Expiração/logout exigem evidência de erro pertinente, não qualquer resposta de falha.

Adicionados `lab/safety.mjs`, `lab/cleanup.mjs` e `test/lab-validation.test.js`; conversor, runner, harness e README atualizados. As correções se limitam ao laboratório. Não alteramos `server.js`, portal aprovado, funcionalidades fiscais, dependências da aplicação, SQL ou políticas de produção.

### Matriz desta missão

| Fase/cenário | Estado | Evidência e alcance |
| --- | --- | --- |
| Executor, escrita, Docker e CLI | APROVADO | Diagnóstico direto; EROFS permanece resolvido |
| Capacidade para stack oficial | BLOQUEADO | Driver vfs e apenas ~3,5 GB livres; sem mudança e sem nova tentativa de pull |
| Revisão/correções de laboratório | APROVADO quanto à regressão | Defeitos acima cobertos por testes unitários/de protocolo, sem simular aprovação Supabase |
| Regressão local | APROVADO | **274/274**, incluindo todos os 236 anteriores e 38 novos; zero falhas/skip |
| Sintaxe | APROVADO | Sete comandos solicitados e checks adicionais de safety/cleanup/teste |
| C — Stack oficial, Mailpit, migrações, contas | BLOQUEADO | Nenhuma stack saudável ou fixture criada |
| D — Auth/RLS/REST/Storage/revogação/auditoria reais | BLOQUEADO | **Zero cenários Supabase E2E executados** |
| E — UI desktop/mobile com Supabase real | BLOQUEADO | Harness revisto, integração real ainda não executada |
| F — Signup fechado em produção | REPROVADO no critério; ação BLOQUEADA | GET real HTTP 200, disable_signup=false; Email ativo e mailer_autoconfirm=false |
| Credencial administrativa compatível | BLOQUEADO | Ausência de token de gestão verificada somente como booleano; ferramentas conectadas sem atualização Auth |
| Cleanup de fixtures reais | NÃO EXECUTADO / não aplicável | Zero fixtures criadas; confirmação de cleanup testada somente com dependências controladas |
| Novo CI | Conferir comentário de entrega | Somente declarar aprovação dos runs do SHA final correspondente |

Os testes novos usam dados sintéticos e dependências controladas, incluindo um servidor HTTP de teste que verifica o contrato do encerramento. **Não são Supabase real**, não comprovam que os formatos/payloads são aceitos pela stack e não encerram as fases C/D/E. O runner revisto continua precisando de execução integral em host adequado, sem ignorar falhas de compatibilidade.

### Produção, custos e retomada

Signup foi reconferido em leitura: `disable_signup=false`, `external.email=true`, `mailer_autoconfirm=false`. Nenhuma mudança, conta, e-mail, RLS, SMTP ou URL de produção. A alteração específica permanece autorizada, mas não há mecanismo administrativo autenticado compatível disponível. Proprietário pode executar [Authentication → Sign In / Providers](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop/auth/providers) → **Allow new users to sign up OFF** e salvar mantendo todas as demais opções; verificar antes/depois sem compartilhar credenciais. Não usar SQL interno nem inventar acesso de gestão.

Risco residual principal: E2E real ainda ausente, laboratório não provado contra as imagens fixadas, signup aberto e aviso de senhas vazadas Pro+. Limpeza agora recusa ambiguidades, mas uma criação sem resposta exige conferência humana restrita ao lote. Uma gravação aceita não é desfeita por ignorar callback. Custo contratado adicional R$ 0; nenhum projeto externo/serviço pago criado. Próximo requisito é **host com armazenamento Docker suficiente**, seguido de execução da matriz e UI, não outra tentativa no host atual. **Etapa 01 parcialmente bloqueada, PR draft, sem merge/deploy ou missão 02; aguardar GPT-6.**

## Missão 01.8.1 — links locais de convite e recuperação

Corrigido o uso incorreto de `localBase()` em `mailLink()`: bases de configuração continuam estritas, enquanto `localAuthLink()` aceita exclusivamente HTTP/127.0.0.1 na origem exata do Supabase configurado, caminho `/auth/v1/verify`, token não vazio e tipo esperado `invite` ou `recovery`. Se presente, `redirect_to` deve ser exatamente `http://127.0.0.1:5517/juridico/portal`; sua ausência usa o site_url local documentado. Credenciais, fragmentos, parâmetros desconhecidos/duplicados e retornos arbitrários são recusados com erro fixo sem URLs/tokens. Links malformados no email não expõem seu conteúdo em erros de parsing.

Regressão: **299/299 testes locais**, preservando 274 e acrescentando 25 positivos/negativos. Dez arquivos JS/MJS verificados com `node --check`; `git diff --check` aprovado. CI do SHA final no comentário do PR. Testes novos são unitários, não E2E Supabase. Código de produção inalterado, sem pulls/start. Bloqueios de capacidade, E2E real e fechamento administrativo do cadastro público permanecem. PR draft, etapa 01 parcialmente bloqueada; sem merge/deploy/missão 02.
