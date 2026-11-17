# Laboratório hospedado independente — aprovação pendente

Proposta: **radar-juridico-lab**, organização **Xixis** (`hwjjvpmhopftkwcbscnx`), região **sa-east-1**, plano **Free**, cotação oficial **US$0/mês** em17/11/2026. Não é branch nem clone da produção. Nenhum recurso criado. Confirmação de custo não substitui autorização específica solicitada ao proprietário.

## Elegibilidade observada

API get_organization confirmou free/tier_free; get_cost retornou project/monthly/amount0. Foram listados cinco projetos, todos INACTIVE (pausados), nenhum laboratório com esse nome. [Regra oficial](https://supabase.com/docs/guides/platform/billing-on-supabase): dois projetos Free ativos entre organizações em que o usuário é Owner/Admin; pausados não contam. A lista disponível indica espaço para laboratório, mas a criação ainda valida elegibilidade global/capacidade/região. Se recusar ou exigir upgrade, parar; não retomar, excluir ou transferir projetos existentes. Não alterar cobrança/plano/cartão. Reconfirmar cotação/plano imediatamente antes da criação autorizada.

Free: banco500MB/projeto, Storage1GB, quotas de tráfego/MAU e pausa por inatividade; não é serviço com SLA. Fixtures pequenas e poucos usuários mantêm planejamento dentro das quotas, mas não são saldo de uso medido. Nada pago será habilitado para ultrapassar limite.

## Preparação concreta e bloqueio da produção

`authorization.json` versionado mantém creationApproved=false/projectRef=null. Nenhum endpoint hospedado é permitido até aprovação específica, criação legítima e posterior fixação do ref **exato** com revisão. Não preencher com ref de outro projeto existente. `target.mjs` sempre nega `kokpxikvisheaxkicmop`, inclusive se colocado na autorização; aceita exclusivamente HTTPS no host canônico do ref aprovado, sem caminho/query/credenciais. Transporte prende alvo imutável, permite apenas Auth/REST/Storage, rejeita redirects e erros não incluem URL/token. Não aceita variável que sobreponha allowlist.

`validate-hosted.mjs inspect` é entrada hospedada separada, somente readiness após allowlist; não é execução da matriz E2E. Config privado externo ao Git em RADAR_HOSTED_LAB_CONFIG: projectRef, url exata e publicKey do laboratório. Não pedir/enviar credenciais em chat. Chave administrativa nunca vai ao portal. Runner local e suas proteções loopback/Docker/Mailpit permanecem intactos. Não apontar o runner local ao hosted.

Preparação offline, sem Docker/rede/provisionamento:

```bash
# caminho privado fora de qualquer checkout; não imprimir/compartilhar conteúdo
node Sitezino/lab/hosted/prepare.mjs /CAMINHO_PRIVADO/hosted-plan.private.json
```

Plano0600 contém runUUID, quatro identidades @example.test/senhas aleatórias e cópia com SHA256 dos SQL existentes, nesta ordem:
1. database/radar-juridico.sql
2. database/authorized-access-and-movements.sql
3. database/private-audit-trail.sql

Nenhuma conta/DDL criado; SQL de produção não modificado. Aplicar **todos** em banco vazio do laboratório, após conferir ref/organização/nome/plano via management oficial. Primeira migração tem políticas intermediárias; não criar fixtures antes de aplicar todas. Validar grant/schema exposure, RLS nas sete tabelas, gate legal_access e bucket legal-private privado/10MB/MIMEs depois. Não adicionar RPC privilegiada para facilitar runner. Não aplicar SQL pela credencial de usuário comum.

Provisionamento futuro: MCP apply_migration com project_id exato do laboratório, nomes correspondentes aos três arquivos e SQL do plano verificado; somente após autorização. Nenhuma chamada a produção. As migrations ainda não foram aplicadas nem testadas em Postgres hospedado. Sem credencial administrativa/DB segura do laboratório, bootstrap/oráculo/auditoria/cleanup permanecem bloqueados. Não reutilizar credencial hospedada de produção.

## A/B/C/D e matriz

A: administrador habilitado; B: advogado habilitado; C: Auth válido sem linha legal_access; D: habilitado e depois revogado durante sessão. Contas exclusivamente sintéticas, runUUID em registros/paths. Futuros casos da matriz existente devem usar JWT de usuário, nunca service_role representando usuário comum. Admin serve só para bootstrap/oráculo/cleanup escopado. O plano offline define identidades, não comprova criação ou login.

Matriz completa Auth/CRUD/eventos/movimentos/documentos/RLS/Storage/auditoria e cleanup do manifesto ainda exige adaptação do transporte SQL/oráculo e captura de links: `validate-real.mjs` usa docker exec/psql e Mailpit e **não é portável diretamente**. Não transformamos falta dessa adaptação em teste aprovado nem escrevemos RPC com bypassRLS. Transport/alvo e plano estão preparados; suite hospedada completa ainda não executável neste commit. Deve ser completada/revisada após laboratório existir e credenciais seguras disponíveis.

## Convite e recuperação sem Mailpit

[SMTP padrão](https://supabase.com/docs/guides/auth/auth-smtp): só destinatários da equipe e2 mensagens/h; @example.test não recebe. Não contornar limites, cadastrar e-mails reais como fixtures ou adicionar equipe para simular caixa postal.

Alternativa oficial gratuita [admin.generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink), REST /auth/v1/admin/generate_link, gera link invite/recovery sem enviar email, com chave administrativa do **lab**. Pode validar consumo real do token, senha e sessão, com redirect exato de loopback. Isso **não testa envio SMTP, recepção, template ou botão público recover**. Links não vão a logs/screenshots. Ainda requer implementar coletor de links separado do localAuthLink (que deve continuar loopback), pinando HTTPS/ref/path/type/redirect do laboratório. Nenhum link gerado nesta missão.

SMTP próprio já existente ou plano gratuito de provedor legítimo só após prova de quotas/custo/credenciais e autorização do proprietário; nenhum provedor contratado ou conta criada. Caixa postal descartável pública expõe links e não é aceita. Recuperação completa via email fica explicitamente pendente sem SMTP/caixa privada elegível.

## Interface isolada e limpeza

Usar browser headless no executor e portal/harness em127.0.0.1; nenhum Render/deploy/site público. Harness local existente recusa upstream hospedado: **não foi alterado**. Variante hosted futura deve usar exclusivamente transporte pinned deste diretório, manter Host/Origin/CSP/no-store e nunca expor adminKey. UI ainda não executável contra hosted neste commit; desktop/mobile/login/logout/CRUD devem ser verificados depois com backend real, sem mocksE2E.

Após executar: remover apenas usuários/objetos/registros runUUID e confirmar ausência, sem apagar projeto/contas de terceiros. Preservar manifesto privado em falha. Projeto Free não será excluído automaticamente; exclusão específica depende de autorização. Nenhuma limpeza real aplicável hoje: zero recursos criados. Produção não foi consultada em dados/Auth/config; apenas listagem administrativa de projetos necessária à elegibilidade.
