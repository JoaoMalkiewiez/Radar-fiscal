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
