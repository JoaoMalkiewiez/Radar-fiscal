# Radar Jurídico v1 — preparação e operação

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
