# Radar Jurídico v1 — preparação e operação

> **Guia histórico de implantação v1:** os trechos abaixo descrevem a preparação original de outubro/novembro de 2026. Não use declarações antigas de "não implantado" ou "PR draft" como estado atual. Para o status atualizado, pendências e sequência obrigatória, consulte [RADAR_JURIDICO_ROADMAP.md](RADAR_JURIDICO_ROADMAP.md). O Radar Jurídico foi publicado no Render, e a conta inicial de administrador foi autorizada; a validação E2E ainda está pendente.
>

## Estado em 10/11/2026

- **Supabase exclusivo criado**: [Radar Jurídico](https://supabase.com/dashboard/project/kokpxikvisheaxkicmop), região sa-east-1.
- **Migrações já executadas** nesse projeto: `radar_juridico_v1_private_schema`, `radar_juridico_relation_indexes` `legal_authorized_users_and_process_movements` e `legal_private_audit_trail`.
- Sete tabelas (`legal_clients`, `legal_cases`, `legal_events`, `legal_documents`, `legal_movements`, `legal_access`, `legal_audit_logs`) com RLS ativada. Acesso direto de `anon` negado.
- Além da conta autenticada, é necessário registro autorizado em `legal_access` com `enabled = true`.
- Bucket `legal-private` privado, até 10 MB por objeto.
- **Código disponível apenas na branch `feat/radar-juridico-v1` e em PR draft**. Nenhum deploy no Render.
- Publicação está bloqueada até concluir os testes abaixo.

## Pendências obrigatórias ANTES de publicar e cadastrar clientes reais

1. **Authentication → Providers → Email:** desabilite cadastro aberto (signups). Crie/convidе os advogados por mecanismo administrativo; confira recuperação de senha e MFA.
   Após criar o usuário, abra **Authentication → Users** e copie seu UUID. No **SQL Editor**, substitua `UUID_DO_USUARIO` no comando a seguir e execute:

   ```sql
   insert into public.legal_access (user_id, enabled, role)
   values ('UUID_DO_USUARIO'::uuid, true, 'administrador')
   on conflict (user_id) do update set enabled = true, role = excluded.role;
   ```

   **Não use e-mails, senhas ou tokens em SQL compartilhado.** Para desativar uma conta, defina `enabled = false` e revogue também as sessões em Auth. Alterações na autorização não invalidam automaticamente JWTs ainda válidos; a política verifica `legal_access` nas consultas.
2. Revise as regras de acesso: esta v1 **separa os dados por conta**. Não existe ainda compartilhamento seguro entre contas de um mesmo escritório.
3. Teste de ponta a ponta com **duas contas autorizadas**: login, cliente, processo, movimentação, agenda, upload/download e tentativas de ler ou vincular registros da outra conta. Teste também uma **terceira conta sem autorização**, que deve receber bloqueio mesmo com senha válida. Não use dados reais nos testes.
4. Examine a política LGPD, retenção de documentos, trilha de auditoria, backup e **restauração testada**. O plano Free não oferece as mesmas garantias que os planos pagos. Não use documentos sigilosos em produção sem aceitar e mitigar os riscos.
5. Corrija qualquer teste de CI pendente antes de merge.
6. Só após aprovação de publicação, configure estas variáveis no **Render**, sem chaves secretas:
   - `LEGAL_SUPABASE_URL=https://kokpxikvisheaxkicmop.supabase.co`
   - `LEGAL_SUPABASE_PUBLISHABLE_KEY=<chave sb_publishable do projeto>`
   A chave publicável está em **Supabase → Project Settings → API Keys**. Ela é projetada para uso público; **não use a secret key ou service_role**.
7. Atenção: o Render acompanha `main` com deploy automático. **Não faça merge do PR draft** antes da aprovação, pois merge acionará uma publicação.
8. O endpoint `/api/juridico/config` responde **503** enquanto as variáveis não existirem: comportamento esperado. A política CSP somente libera o domínio Supabase configurado.

## Como usar a área após a ativação

1. Abra `/juridico/portal` na URL do Radar Fiscal e entre com a conta de advogado autorizada.
2. Em **Clientes**, registre uma pessoa física/jurídica e selecione **Salvar cliente**.
3. Em **Processos**, cadastre título e número CNJ e vincule ao cliente. Utilize **Registrar movimentação processual** para anotar cada acontecimento e criar uma linha do tempo manual. Os registros permitem edição na própria lista.
4. Em **Documentos**, escolha um processo, selecione PDF, DOCX, PNG ou JPG até 10 MB e envie. O download é autorizado pelo próprio token e pela política RLS de Storage.
5. Em **Agenda e prazos**, registre tarefas, audiências e compromissos. Filtre pendentes, marque itens como concluídos e revise os vencidos no dashboard. O sistema **não calcula automaticamente prazos judiciais**; confira datas nos sistemas oficiais.
6. Em **Visão geral**, consulte os contadores da própria conta, os próximos prazos e as atividades recentes (auditoria sem conteúdo de documentos). Use o campo de pesquisa em cada módulo. Clique em **Sair** para encerrar a sessão local e tentar revogá-la no Supabase.

O portal não usa notificações do navegador, pop-ups ou sons; o retorno das operações é exibido na própria página. O token e o refresh token permanecem **somente em memória**, sem persistência no localStorage. Recarregar exige novo login.

## Limites da v1

- Cadastro, listagem, pesquisa e edição de clientes/processos/agenda/movimentações; exclusão de documentos com confirmação em duas etapas. Não há colaboração de equipe na v1.
- Nenhuma integração automática com tribunais ou cadastro privado de CPF.
- A página de ferramentas jurídicas públicas continua intacta.
- O uso de Supabase direto do navegador depende da configuração correta de RLS e Storage.

## Migrações versionadas no GitHub

Uma instalação nova executa, em ordem, `database/radar-juridico.sql`, `database/authorized-access-and-movements.sql` e `database/private-audit-trail.sql`. No projeto Supabase já criado ambas as estruturas **já existem**: não reaplique os arquivos desnecessariamente. Nunca execute `drop table` para ajustar a versão.

## Política de auditoria

O banco registra criação, alteração e exclusão de clientes, processos, agenda, documentos (metadados) e movimentações, guardando tipo, UUID, usuário e data. **Não copia CPF, nome, anotação nem conteúdo dos arquivos para os logs.** Cada conta vê apenas sua própria auditoria quando autorizada. Downloads e alterações internas do Supabase Auth não têm auditoria neste MVP; é necessário definir retenção e exportação antes de uso profissional.

## Investigação com resultados reais — primeira etapa

A área **Investigação** é visível somente após login e autorização em `legal_access`.

### Consulta cadastral por CNPJ (gratuita)

1. Informe um CNPJ válido e uma justificativa da diligência.
2. O navegador consulta o endpoint já existente `/api/cnpj`, que agrega respostas públicas da **BrasilAPI** e de **CNPJ.ws pública** quando disponíveis.
3. O sistema mostra razão social, nome fantasia, situação cadastral, endereço, CNAE, capital social e quadro societário **somente quando retornados pela fonte**; registra a fonte, o horário e eventual uso de cache.
4. Se os provedores estiverem indisponíveis, mostra **consulta inconclusiva** — jamais “empresa sem bens”.
5. A finalidade preenchida não é salva e não cria uma ficha da pessoa investigada. O CNPJ é enviado ao backend como parâmetro GET para consultar o cadastro público; **não envie CPF**, que não é aceito nessa operação.

Consulta cadastral NÃO identifica propriedade de veículos, imóveis ou contas, e capital social NÃO é patrimônio comprovado.

### Imóveis rurais por planilha pública do SNCR

1. Na página pública do SNCR (https://sncr.serpro.gov.br/sncr-web/consultaPublica.jsf), selecione UF e município, faça a consulta e salve o arquivo CSV disponibilizado pelo órgão.
2. Em **Investigação → Imóveis rurais**, selecione o arquivo de até 8 MB, informe a abrangência da planilha e o **nome exatamente como aparece no campo Titular**.
3. O navegador lê o CSV em memória, localiza todas as linhas cujo campo `Titular` corresponde ao nome normalizado e mostra denominação, código, área, município, condição declarada e percentual de detenção, quando disponíveis.
4. O CSV **não é enviado ao servidor nem armazenado no Supabase**. Após cada execução, o campo de arquivo é limpo. Não use correspondência por nome como prova de identidade: homônimos podem existir.
5. Resultado zero significa apenas **nenhuma correspondência exata naquela planilha e abrangência**. Não significa que a pessoa não possui imóveis.

O SNCR disponibiliza dados declaratórios. A API `consultarImovelPorCpfCnpj` do Conecta Gov não é uma API livre para aplicativos privados. Não foram implementadas consultas de veículos de terceiros ou imóveis urbanos por CPF.

Fontes de referência:
- BrasilAPI: https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json
- SNCR Consulta Pública: https://sncr.serpro.gov.br/sncr-web/consultaPublica.jsf
- RFB sobre campos de CSV: https://www.gov.br/receitafederalpt-br/pt-br/assuntos/orientacao-tributaria/cadastros/portal-cnir/estatisticas-e-dados-abertos
- SNCR Conecta Gov (acesso restrito): https://www.gov.br/conecta/catalogo/apis/sncr-sistema-nacional-de-cadastro-rural

**Antes de permitir uso com dados reais de clientes:** testar fluxos com contas autorizadas, verificar finalidade/base legal, implementar política de retenção, backup e segurança da conta. Esta versão não serve como laudo conclusivo de inexistência de patrimônio.

### Processos judiciais públicos pelo CNJ DataJud (gratuito)

Na aba **Investigação**, informe o número CNJ de 20 dígitos e selecione o tribunal. O sistema consulta o endpoint público do CNJ e apresenta somente metadados retornados, como número, órgão julgador, classe, assuntos e movimentações públicas. A consulta é por **número processual**, não CPF, nome ou bens. O endpoint público `/api/juridico/datajud` valida rigorosamente o tribunal e os 20 dígitos, impõe limite por IP e não aceita URL arbitrária. Nenhum resultado não comprova inexistência de processo. Processos sigilosos não são acessíveis.

A chave **pública** do CNJ é publicada em https://datajud-wiki.cnj.jus.br/api-publica/acesso/ e pode mudar; caso expire, atualize a variável opcional `DATAJUD_PUBLIC_KEY` no Render com a nova chave pública, sem comitar credenciais privadas. Não há custos de API, mas disponibilidade e limites dependem do CNJ. Consulta oficial e exemplo: https://datajud-wiki.cnj.jus.br/api-publica/exemplos/exemplo1/.

**Importante:** a atual versão continua sem consulta gratuita automática e universal de imóveis urbanos ou veículos por CPF de terceiros. Não tente contornar autenticação dos órgãos. A base SNCR é declaratória e a leitura via CSV é local.
