# Laboratório hospedado — Missão 01.13

Projeto existente **radar-juridico-lab**, ref **pkiowhcjmxfznhuhrxvj**, organização Xixis, região sa-east-1, Free/R$0. Confirmado ACTIVE_HEALTHY; baseline já aplicada pelo GPT-6. **Não criar outro projeto, reaplicar SQL ou restaurar/alterar produção.** Autorização agora fixa exatamente esse ref no código e em authorization.json; produção kokpxikvisheaxkicmop sempre negada, inclusive se configurada na allowlist. Alvos arbitrários com autorização modificada também são negados.

## Execução comprovada e limite

[Evidência sanitizada](evidence/mission-01-13-public.json), coletada em17/11/2026:

- Settings Auth HTTP200; disable_signup=false observado no laboratório, sem mudança.
- Sete tabelas recusaram acesso anônimo com HTTP401/SQLSTATE42501.
- Login inexistente retornou HTTP400/invalid_credentials, sem criar conta.
- Chromium real1440px/390px, portal em127.0.0.1 com proxy ao laboratório: login inválido, workspace oculto, formulário recovery visível sem envio, armazenamento do navegador vazio e zero pageerrors. Sem mocks ou interceptação de respostas.
- SQL do laboratório confirmou sete tabelas com RLS e bucket privado10MB. Ao finalizar, zero usuários, autorizações, registros, auditorias e objetos.

**Não é validação de isolamento autenticado**. Proprietário confirmou que nenhuma chave administrativa do laboratório foi configurada. Sem essa credencial não criamos A/B/C/D nem geramos JWTs/links. Login válido, refresh, logout, recuperação com token/email, revogação, uploads/downloads/exclusão e interface autenticada seguem BLOQUEADOS. Não manipulamos auth.users por SQL nem fabricamos JWTs. Nada a limpar: zero fixtures criadas; harness foi encerrado. Testes SQL simulados prévios do GPT-6 não são evidência desta execução E2E.

## Como reproduzir os fluxos públicos

Arquivo JSON privado fora do Git, modo0600, fornecido por RADAR_HOSTED_LAB_CONFIG, contém projectRef, url exata `https://pkiowhcjmxfznhuhrxvj.supabase.co`, publicKey ativa do laboratório. Sem credenciais de produção. Nunca imprimir conteúdo. Endpoints pinados, redirects recusados e mensagens sanitizadas.

```bash
node Sitezino/lab/hosted/validate-hosted.mjs inspect
node Sitezino/lab/hosted/probe-public.mjs /CAMINHO_PRIVADO/evidence-api.json
node Sitezino/lab/hosted/portal-harness.mjs
# em outro terminal do mesmo executor, com Playwright e Chromium existentes:
node Sitezino/lab/hosted/ui-public-check.cjs /CAMINHO_PRIVADO/evidence-ui.json
```

Inspect e probe são verificações públicas; não são matriz autenticada. Harness só escuta127.0.0.1:5517. Publica só chave pública; jamais chave administrativa. Reutiliza portal-server.mjs com o harness local, mantendo CSP/Host/Origin/no-store/limite de corpo. Entry local ainda exige loopback; entry hosted valida ref antes de iniciar servidor. Nenhuma política da aplicação de produção foi alterada.

Neste executor Node24 exigiu **NODE_USE_ENV_PROXY=1** para respeitar proxy do ambiente; manter HTTPS_PROXY/HTTP_PROXY/NO_PROXY e certificados herdados, sem desativar TLS. Isso resolveu conectividade sem alterar produção ou guardas. Não presuma comportamento idêntico em outro Node/runner. Os outputs devem ser arquivos novos; falha por saída já existente não exige repetir chamadas reais.

O primeiro checker de navegador aguardava corpo/resposta de forma instável nesta configuração. Foi corrigido para coletar status da resposta e aguardar feedback visível, mantendo HTTP400 e backend real como exigências. Falhas intermediárias do checker não foram classificadas como defeito da aplicação ou aprovação. O script falha com fase/tipo de erro, sem URL/senha/token. Recuperação apenas abre o formulário; não envia email.

## Desbloqueio autenticado

Falta provisionar **credencial administrativa exclusiva do laboratório por arquivo privado/variável segura**, nunca pelo chat/Git/logs. Não é nova autorização de custo ou criação. API MCP atual permite SQL/metadados/chave pública, mas não oferece administração Auth ou entrega de segredo do projeto. Depois, integrar bootstrap A/B/C/D, oracle/cleanup e matriz completa; validate-hosted ainda não implementa esses modos. Config público atual não contém adminKey. Não usar SQL para criar usuários Auth nem credencial de produção como atalho.

Usar o plano offline preparado na01.12 somente como referência; IDs/senhas locais não criam contas. Confirmar vazio antes de bootstrap, rastrear UUIDs e paths por run, executar escritas como usuários reais, confirmar negativas por SQLSTATE/códigos pertinentes e confirmar limpeza. Não adicionar RPC com bypassRLS. Baseline SQL já aplicada, deve apenas ser conferida.

SMTP padrão limita destinatários à equipe e2mensagens/h. admin.generateLink é alternativa oficial sem envio para testar verificação invite/recovery, não comprova SMTP/recepção/templates. Nenhum envio/link gerado nesta missão. Não contornar limite nem usar caixa descartável pública. Mailpit/Docker não utilizados.

Sem merge/deploy/contratação/missão02; PR12 permanece draft e etapa01 parcialmente bloqueada. Nenhum teste cria recurso ao rodar npm test; E2E públicos são explicitamente acionados pelos comandos acima.
