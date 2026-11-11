# Radar Jurídico — roteiro de evolução com aprovação por testes

> Documento de referência persistente. Última revisão: 11/11/2026.
> Projeto: `JoaoMalkiewiez/Radar-fiscal` · hospedagem Render · Supabase dedicado.
> **Prioridade absoluta:** manter Radar Fiscal e Radar Jurídico existentes funcionando.
> **Orçamento incremental:** R$ 0. Nenhuma assinatura, serviço pago ou consulta onerosa sem autorização expressa.

## Leitura obrigatória antes de cada próxima melhoria

1. Ler **este arquivo na branch `main`**, `RADAR_JURIDICO_SETUP.md`, workflows de CI e estado mais recente do GitHub (PRs/issues), Render e Supabase, se a tarefa tocar nesses serviços.
2. Localizar **primeira etapa NÃO CONCLUÍDA** abaixo, respeitando dependências e bloqueios. Não inferir progresso de uma resposta anterior: verificar GitHub/deploy/testes.
3. Criar **branch específica**; não desenvolver diretamente em `main`.
4. Executar testes unitários, regressão e segurança aplicáveis; documentar o resultado e o que não pôde ser testado; abrir PR.
5. **Publicar somente depois de CI verde e revisão dos riscos**. Merge em `main` aciona deploy automático no Render. Confirmar deploy `live` no commit esperado e executar smoke test das rotas.
6. Marcar etapa como **CONCLUÍDA** somente após os critérios de aceite e provas da execução; atualizar este roteiro no mesmo PR ou em PR documental imediato.
7. **Não executar tarefas autonomamente entre conversas**: retomar mediante pedido do usuário, consultando este arquivo. Avançar à próxima etapa na mesma solicitação somente quando houver tempo, testes e nenhuma necessidade de aprovação externa.

### Estados

- **CONCLUÍDA:** testes e aceites documentados, PR mesclado, deploy verificado quando aplicável.
- **EM ANDAMENTO:** branch/PR aberto ou implementação pendente de testes.
- **BLOQUEADA:** depende de credencial, autorização humana, API, conta de teste ou outro pré-requisito.
- **PENDENTE:** não iniciada.
- **ADIADA:** não há fonte gratuita/legítima disponível, ou o benefício não justifica o risco.

## Estado atual verificado em 11/11/2026

- Render URL: `https://radar-fiscal-iyn3.onrender.com`.
- Portal privado: `/juridico/portal`; Dockerfile corrigido para copiar arquivos privados; autenticação e recuperação de senha já têm UI.
- Supabase Radar Jurídico: projeto `kokpxikvisheaxkicmop`; RLS e bucket privado implementados; primeira conta de administrador autorizada. **Login completo + operações reais com conta de teste ainda NÃO validados.**
- O Supabase padrão retornou HTTP **429 (limite de e-mails)** em recuperação; UI foi corrigida para não dizer que enviou e-mail quando a fonte recusou. Não prometer desbloqueio em horário exato.
- Investigação: CNPJ público com BrasilAPI/CNPJ.ws; consulta pública DataJud por número de processo; CSV SNCR local, por nome exato, sem provar propriedade. Nenhuma API universal gratuita de imóveis urbanos/veículos por CPF.
- CI atual: `Validate Radar Fiscal` e `Radar Juridico - verificacoes (sem deploy)`; o PR de correção da recuperação de senha passou. **CI verde não substitui E2E real de Supabase, fontes ou produção.**

## Sequência e critérios de aceite

| Ordem | Etapa | Estado | Dependência | Entrega e evidência para avançar |
|---|---|---|---|---|
| 00 | Linha de base, rastreabilidade e roteiro | **CONCLUÍDA (documental)** | Nenhuma | Roadmap versionado; CI aprovado; documentação atualizada |
| 01 | Autenticação, permissões e recuperação | **BLOQUEADA parcialmente** | SMTP/limite de e-mails e conta de teste para E2E | Convite/recuperação testados com URL correta; erros 429 explícitos; logout; sessão expirada; usuário sem acesso bloqueado; nenhuma credencial exposta |
| 02 | Dashboard de gestão | **PENDENTE** | Testes básicos de autenticação | Resumo útil de clientes, processos, prazos e atividade, preservando ações CRUD e responsividade |
| 03 | Relatório de investigação em PDF | **PENDENTE** | Definir dados autorizados e saída | PDF com fonte, instante da consulta, escopo, status, ressalvas e SEM afirmar inexistência absoluta de bens; sem enviar dados sensíveis a terceiros |
| 04 | Busca e apresentação de resultados | **PENDENTE** | Fontes gratuitas confirmadas | Melhorar mensagens e resultados de CNPJ/DataJud/SNCR; testes de falha, resposta parcial e nenhum resultado; nunca inventar registros |
| 05 | Histórico privado de pesquisas | **PENDENTE** | Política LGPD e banco seguro | Armazenamento opt-in, finalidade, data, fonte, rastreabilidade e exclusão; RLS e testes de isolamento |
| 06 | Vinculação entre pesquisas, clientes e processos | **PENDENTE** | Etapa 05 | Vínculos por identificadores internos, sem exposição cruzada de usuários e sem perda de dados |
| 07 | Agenda, prazos e alertas internos | **PENDENTE** | Etapa 02 | Alertas dentro do painel, sem alegar cálculo de prazo judicial; testes de fuso horário e prazos vencidos |
| 08 | Usabilidade, mobile e acessibilidade | **PENDENTE** | Etapas 02–04 | Navegação acessível por teclado, feedback claro, layouts mobile sem regressões |
| 09 | Segurança, backup, auditoria e operação | **PENDENTE (revisão contínua)** | Todas | Revisar RLS/Storage, retenção LGPD, restauração testada, limites Free, configuração Auth e auditoria; não colocar documentos reais sensíveis antes da validação |
| 10 | Ampliação patrimonial gratuita | **PENDENTE / sujeita a viabilidade** | Fontes oficiais autorizadas | Somente fontes com permissão explícita e integração gratuita; "não localizado na fonte" ≠ "não possui bens"; nunca contornar login ou cobrar ocultamente |

**Regra de priorização:** resolver primeiro qualquer regressão crítica ou falha de autenticação/segurança, mesmo que a ordem numérica seja interrompida. Não permitir etapa com escrita de dados confidenciais enquanto E2E/RLS/backups não estiverem verificados.

### Detalhamento da etapa 01 (próxima a destravar)

Tarefa rastreável: [GitHub Issue #10](https://github.com/JoaoMalkiewiez/Radar-fiscal/issues/10).

- Conferir URLs do Supabase Auth: site público e redirecionamento para `/juridico/portal`. A configuração de projeto pode exigir ação manual no dashboard.
- Evitar envio repetido durante rate limit 429; avaliar SMTP gratuito somente se as condições contratuais e limites forem confirmados, sem criar custos ou armazenar segredos no GitHub.
- Testes: login, conta autorizada, conta sem `legal_access`, recuperação de senha, convite, token expirado, refresh, logout, reentrada, erro de rede.
- E2E **com dados sintéticos**: criar, editar, listar e apagar cliente/processo; anexos permitidos; verificar que usuário B não lê ou altera registros de usuário A; validar Storage e auditoria.
- Se depender da aceitação do usuário ou ação do provedor, registrar **BLOQUEADA** e executar apenas melhorias independentes, sem declarar a etapa concluída.

## Checklist obrigatório para TODO PR

- [ ] Escopo restrito e estratégia de reversão documentada; sem remover funcionalidades existentes.
- [ ] Não alterou indevidamente endpoints públicos CNPJ/CPF/SEFAZ, rotas e UI pública.
- [ ] `node --check` nos JS tocados e `npm test` (Sitezino); CI GitHub verde.
- [ ] Testes de novo comportamento, erro, indisponibilidade, ausência de registro e entrada inválida.
- [ ] Se mudar Docker: verificar `COPY` e carregamento da rota na imagem, não apenas no workspace.
- [ ] Se mudar Auth/RLS/Storage: conferir política em Supabase, `get_advisors(type=security)`, isolamento e bloqueio de usuário não autorizado.
- [ ] Se mudar fontes externas: testar respostas reais quando permitido, limites, rate limit, falhas e metadados de origem. Sem atribuir posse de bens por mera coincidência de nomes.
- [ ] Não colocar dados reais de cliente, senhas, tokens, CPF de terceiro ou chaves privadas no repositório, logs, testes ou histórico.
- [ ] PR com resumo de testes + limitações; merge apenas com checagens aprovadas.
- [ ] Verificar Render status `live` após merge e smoke tests de pelo menos `/`, `/juridico`, `/juridico/portal`, `/api/health`.
- [ ] Atualizar **estado da etapa e evidências** neste arquivo (PR, SHA, workflow, deploy). Se houver bloqueio, anotar aqui e não avançar como se tivesse passado.

## Registro de execução (append-only)

| Data | Etapa | Decisão/resultado | Evidências | Próxima ação |
|---|---|---|---|---|
| 11/11/2026 | 00 | Roadmap criado, guia histórico referenciado e issue #10 aberta. Nenhuma alteração de runtime nesta etapa. | [PR #11](https://github.com/JoaoMalkiewiez/Radar-fiscal/pull/11); checks Validate Radar Fiscal e Radar Jurídico verificados no PR | Etapa 01: destravar Auth/SMTP e E2E de permissões |
| 11/11/2026 | 01 | Missão 01 em revisão: proteção contra respostas após logout, limpeza de DOM, erros/429, sanitização de links e logout mobile; 83 testes locais aprovados, Chromium com Auth simulado. Etapa segue parcialmente BLOQUEADA por E2E real/SMTP e contas sintéticas indisponíveis. Sem merge/deploy ou mudança de RLS. | Branch `fix/juridico-auth-session-security`; [relatório técnico](RADAR_JURIDICO_AUTH_REVIEW.md) | Revisão GPT-6, CI e validação real multiusuário antes de concluir etapa 01 |

## Critérios permanentes de produto

- **Precisão:** sempre apresentar dado real com fonte/escopo/data, distinguindo "encontrado", "não localizado" e "não consultado/indisponível".
- **Privacidade:** LGPD, acesso por usuário/autorização e mínimo de dados pessoais; não executar consulta em massa ou acesso indevido.
- **Gratuidade:** orçamento adicional zero; oferecer alternativas legítimas sem afirmar que integração restrita é pública.
- **Confiabilidade:** nenhuma alteração quebra o site fiscal original; preferir incrementos pequenos e reversíveis.
- **Continuidade:** a próxima conversa começa pela leitura deste documento na `main`, não por uma promessa de trabalho em segundo plano.
