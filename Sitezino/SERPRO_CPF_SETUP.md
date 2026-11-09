# Integração opcional Consulta CPF v3 — Serpro

## Estado atual

O módulo existe no backend do Radar Fiscal, mas fica **desativado por padrão**. A validação matemática gratuita e os links da Receita Federal continuam independentes. A consulta ao Serpro exige contratação, credenciais reais e finalidade legítima.

**Importante:** Consulta CPF v3 não retorna endereço, telefone, imóveis ou veículos. A fonte oficial exige o CPF **e a data de nascimento**. O endpoint de produção pode gerar cobrança por consulta, inclusive em certas respostas de erro (como 404).

## Contratação

1. Consulte a documentação oficial: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/
2. Leia as regras contratuais e de tratamento dos dados pessoais.
3. Após a contratação, obtenha a **Consumer Key** e a **Consumer Secret** na Área do Cliente Serpro.
4. Não compartilhe essas credenciais em issues, GitHub, chats ou no código-fonte.

## Configuração segura no Render

No serviço do Radar Fiscal, configure as variáveis de ambiente em **Environment**:

- `SERPRO_CONSUMER_KEY` — valor real do contrato.
- `SERPRO_CONSUMER_SECRET` — segredo real do contrato.
- `CPF_OPERATOR_KEY` — chave administrativa com no mínimo 32 caracteres aleatórios (por exemplo, gere uma string aleatória de 64 caracteres hexadecimais offline). **Não reutilize** a Consumer Secret.
- `CPF_SERPRO_ENABLED` — `1` ativa o módulo **somente após** a configuração dos demais campos.

Sem as quatro variáveis adequadas, `GET /api/cpf/status` retorna `serproDisponivel: false`, e `POST /api/cpf/consulta` retorna HTTP 503, sem chamada paga ao Serpro.

Não coloque as variáveis no Dockerfile, HTML, repositório, screenshots nem arquivos versionados.

## Fluxo da versão operador

1. Abra `/cpf` e identifique a área "Dados oficiais do CPF".
2. Com as quatro variáveis configuradas, o formulário profissional é exibido.
3. Digite CPF, nascimento, chave administrativa e descreva a finalidade; confirme a autorização ou base legal aplicável.
4. O navegador envia `POST /api/cpf/consulta` ao backend (não coloca CPF na URL do Radar Fiscal).
5. O backend valida os parâmetros, limita chamadas, obtém o token OAuth2 e consulta o Serpro.
6. A resposta devolve apenas nome, nome social, situação, data de inscrição (quando houver), fonte e data da consulta; não existe cache de dados pessoais.

## Controles e limitações

- A chave administrativa é um controle temporário **somente para uso próprio / operador de confiança**. **Não** disponibilize esse acesso como serviço público ou venda consultas antes de implementar contas individuais, controles de acesso, trilha de auditoria, políticas de retenção, revisão jurídica e cobrança.
- Máximo atual de 3 requisições por minuto e por IP, além de 20 por hora por processo Node; os limites em memória não são suficientes para ambiente escalonado. Um sistema comercial precisa de contador transacional persistente e controle de custo.
- O Serpro pode responder 200 (sucesso), 206 (dados parciais) e 404 (CPF inexistente ou nascimento divergente). Não trate 404 como autorização para consultas sucessivas.
- Nenhum mecanismo de endereço, telefone ou pesquisa patrimonial foi ativado.
- A política de privacidade do site descreve o fluxo; ainda será necessário definir dados do controlador e canal de atendimento antes de operar comercialmente.

## Referências técnicas oficiais

- API e campos: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/tipos_retornados/
- OAuth2: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/quick_start/
- Erros e cobrança: https://apicenter.estaleiro.serpro.gov.br/documentacao/consulta-cpf/pt/codigos_retorno/

## Testes sem consumo pago

Na pasta `Sitezino`, execute `npm test`. Os testes da API CPF usam respostas **simuladas** e não contatam o Serpro. Não use credenciais reais durante os testes automáticos.
