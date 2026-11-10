# Radar Jurídico — ambiente privado (v1 em desenvolvimento)

O Radar Fiscal público continua no Render. A área em `/juridico/portal` usa um projeto Supabase dedicado com Auth, PostgreSQL e Storage privado. **Não use dados reais antes de validar as políticas e os backups.**

## Configuração pendente

1. Identifique o projeto Supabase correto. Não reutilize bases de outros aplicativos sem autorização.
2. No SQL Editor do projeto, revise e execute `database/radar-juridico.sql`.
3. Em Auth, desative cadastro público e crie/convidе somente os usuários autorizados do escritório. Habilite MFA, se disponível para o método escolhido.
4. Confira que o bucket `legal-private` é privado e que a RLS de todas as quatro tabelas está ativa.
5. Configure as variáveis no serviço Render:
   - `LEGAL_SUPABASE_URL=https://<ref>.supabase.co`
   - `LEGAL_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...`
6. **Nunca** configure `service_role`, secret key ou senha do banco no frontend.
7. Teste com duas contas diferentes: cada usuário deve visualizar apenas seus próprios registros, inclusive arquivos. Teste tentativas de inserir um `owner_id` de outro usuário e vincular processos a clientes de terceiros.
8. Valide rotina de backup e restauração antes de atender clientes reais. O plano gratuito não fornece o mesmo nível de disponibilidade e recuperação dos planos pagos.

## Utilização após a ativação

- **Login:** entre com a conta autorizada. A sessão é mantida somente na memória da página; recarregar exige novo login.
- **Clientes:** preencha os campos e clique em `Salvar cliente`.
- **Processos:** selecione um cliente, informe título, tribunal, número CNJ e status.
- **Documentos:** escolha o processo e envie PDF, DOCX, PNG ou JPG de até 10 MB. O download exige uma sessão válida.
- **Agenda:** cadastre audiência, prazo, tarefa ou compromisso. Confira prazos nos órgãos competentes; o sistema não calcula prazo judicial automaticamente.
- **Dashboard:** acompanha os totais cadastrados na própria conta.
- **Sair:** encerra a sessão local. Não há notificações de navegador, pop-ups ou sons.

## Limitações intencionais da primeira etapa

- Somente criação e listagem; edição, exclusão e colaboração entre advogados são fases posteriores.
- Nenhuma integração automática com tribunais nem consulta real de CPF.
- A área pública e a prévia visual continuam separadas do painel autenticado.
- Sem projeto Supabase confirmado, `/api/juridico/config` responde 503 e o painel não aceita dados.
