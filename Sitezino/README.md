# Radar Fiscal

Consulta gratuita de CNPJ com inscrições estaduais (IE), situação cadastral e monitor de disponibilidade dos serviços fiscais da SEFAZ para **NF-e, NFC-e e CT-e**.

## O que o site mostra

- Dados cadastrais da empresa a partir do CNPJ (razão social, nome fantasia, situação, CNAE, endereço, sócios e capital social).
- Inscrições estaduais localizadas, com estado, número, situação (ativa/inativa) e data da base.
- Card **Serviços fiscais na SEFAZ** com o status de NF-e, NFC-e e CT-e nos estados vinculados à empresa.
- Seção **Monitor SEFAZ** com os 27 estados, abas por documento, busca por UF/estado, filtro **Com alerta**, atualização manual e legenda de status.
- Distinção entre **Sem dados** (a fonte respondeu com `0`) e **Não monitorado** (a fonte não retornou aquele estado/documento).
- Links para os portais oficiais de cada SEFAZ e para o SINTEGRA.
- Histórico local de consultas, cache de 6 horas por CNPJ e URL compartilhável (`?cnpj=`).
- Menu de navegação responsivo em telas de até 900px.
- Alternância entre tema claro e escuro no cabeçalho, com preferência do sistema e persistência local (`radarfiscal:theme`).

## Como executar

Requisitos: **Node.js 18 ou superior**. O projeto não possui dependências externas.

```bash
npm start
```

Ou:

```bash
node start.js
```

Abra `http://localhost:5500`.

O `start.js` usa o repositório de certificados do sistema operacional quando disponível. Isso evita falhas de TLS em redes corporativas com proxy de inspeção. Para executar diretamente sem esse ajuste, use `node server.js`.

O servidor pode ser configurado pelas variáveis de ambiente:

- `PORT`: porta HTTP (padrão `5500`).
- `HOST`: interface de escuta (padrão `0.0.0.0`).
- `PUBLIC_URL`: URL pública usada em `robots.txt` e `sitemap.xml` (por exemplo, `https://radarfiscal.exemplo`).
- `TRUST_PROXY=1`: confia em `X-Forwarded-For` e `X-Forwarded-Proto` quando o site está atrás de um proxy reverso.

### Testes

```bash
npm test
```

Os testes usam apenas o módulo nativo `node:test` e cobrem página inicial, cabeçalhos de segurança, compressão gzip, health check, validação de CNPJ, SEO e limite de requisições. Os testes não consultam as fontes externas.

### Docker

```bash
docker build -t radar-fiscal .
docker run --rm -p 5500:5500 radar-fiscal
```

O `Dockerfile` inclui um `HEALTHCHECK` que consulta `GET /api/health`.

### Por que é necessário usar o servidor Node

O monitor da TecnoSpeed não envia cabeçalhos CORS. Por isso, o navegador não consegue consultá-lo diretamente. O `server.js` faz o proxy em `/api/sefaz-status`, normaliza os dados por UF e mantém um cache de 60 segundos.

A consulta de CNPJ também usa o servidor em `/api/cnpj` para cache e repetição de consultas. Em uma hospedagem estática, o frontend detecta a ausência do endpoint e consulta BrasilAPI/publica.cnpj.ws diretamente, mas **o monitor SEFAZ só funciona quando o site é servido pelo `server.js`** (ou por outro backend que reproduza esse proxy).

## Fontes de dados

| Dado | Fonte | Observação |
| --- | --- | --- |
| Cadastro da empresa | [BrasilAPI](https://brasilapi.com.br/docs) | Dados públicos da Receita Federal |
| Inscrições estaduais | [publica.cnpj.ws](https://publica.cnpj.ws/) | Limite aproximado de 3 consultas por minuto |
| Status NF-e / NFC-e / CT-e | [Monitor SEFAZ — TecnoSpeed](https://monitor.tecnospeed.com.br/) | Consultado pelo proxy do servidor |

O Radar Fiscal é um projeto independente e **não tem vínculo com a Receita Federal, com as SEFAZ ou com a TecnoSpeed**. Os dados são informativos: confirme sempre nos portais oficiais antes de tomar qualquer decisão fiscal.

## Endpoints

### `GET /api/cnpj?cnpj=00000000000000`

Consulta BrasilAPI e publica.cnpj.ws no servidor, com cache em memória de **10 minutos** para respostas completas e **2 minutos** para respostas parciais. Consultas transitórias são repetidas com backoff. Se uma fonte falhar depois do cache expirar, o servidor pode devolver a última versão disponível (até 24h) marcada com `stale: true`.

```http
GET /api/cnpj?cnpj=19131243000197
GET /api/cnpj?cnpj=19131243000197&force=1
```

A resposta contém os dados brutos de `brasil` e `ie`, os erros normalizados de cada fonte, `fetchedAt`, `cached` e `stale`. O frontend faz a mesclagem e a renderização.

### `GET /api/sefaz-status`

```http
GET /api/sefaz-status
GET /api/sefaz-status?force=1
```

Resposta normalizada:

```json
{
  "updatedAt": "2026-10-22T14:17:07.516Z",
  "source": "Monitor SEFAZ · TecnoSpeed",
  "sourceURL": "https://monitor.tecnospeed.com.br/",
  "docs": {
    "nfe": { "SC": 1, "SP": 5 },
    "nfce": { "SC": 1 },
    "cte": { "SC": 1 }
  },
  "errors": {},
  "cached": true
}
```

Códigos de status usados pela fonte:

| Código | Significado |
| --- | --- |
| `1` | Normal (até 2s) |
| `2` | Lento (até 5s) |
| `3` | Muito lento (até 30s) |
| `4` | Sem resposta / timeout |
| `5` | Erro |
| `0` | Sem dados para aquele estado/documento |

Estados ausentes na resposta da fonte são exibidos como **Não monitorado**, pois não há status retornado para aquele estado/documento.

### `GET /api/health`

Retorna `status`, `uptime`, `timestamp` e `version`. Usado pelo health check do Docker.

## Segurança e produção

- Limite por IP: 30 consultas de CNPJ por minuto e 120 consultas do monitor por minuto.
- Cabeçalhos de segurança, incluindo CSP, `X-Frame-Options`, `Referrer-Policy` e `Permissions-Policy`.
- Compressão gzip para HTML, CSS, JavaScript, JSON e XML.
- `robots.txt` e `sitemap.xml` gerados a partir do host da requisição (ou de `PUBLIC_URL`).
- Dados estruturados JSON-LD (`WebSite` e `FAQPage`) na página inicial.
- Nenhum arquivo do servidor é exposto além de `index.html`, `styles.css`, `app.js` e das rotas públicas.

## Estrutura

```text
index.html          Estrutura, conteúdo e dados estruturados
styles.css          Estilos, menu mobile e responsividade
app.js              Consulta de CNPJ, renderização e monitor no navegador
server.js           Servidor estático, cache, proxy e hardening
start.js            Inicializador com CAs do sistema operacional
test/server.test.js Testes com node:test
Dockerfile          Imagem de produção e health check
package.json        Scripts de execução e teste
```

## Limitações

- A base pública de IE pode não retornar inscrições para MEIs, empresas de serviços ou cadastros recentes.
- O `publica.cnpj.ws` aplica limite de requisições; o site trata o limite com cache, fallback e mensagem de espera.
- O monitor representa a disponibilidade dos webservices no momento da consulta. Ele não substitui a consulta oficial de uma nota fiscal.
- O cache é em memória. Em reinícios, a primeira consulta ao monitor pode levar alguns segundos.
