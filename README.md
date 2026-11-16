# Radar Fiscal

**Brazilian fiscal information lookup and SEFAZ service monitoring.** Built with Node.js and vanilla JavaScript.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/Tests-node%3Atest-222222)](Sitezino/test)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](Sitezino/Dockerfile)

## Overview

Radar Fiscal provides public CNPJ data, state-registration information and visibility into SEFAZ service availability for **NF-e, NFC-e and CT-e**. The application includes a responsive interface, light/dark themes, query history and a shareable CNPJ URL.

The main application is located in **[`Sitezino/`](Sitezino/)**. The repository also contains **Radar Jurídico**, a separate work-in-progress area. Its features should not be assumed production-ready.

## Features

- Company registration and state-registration lookup by CNPJ
- SEFAZ status monitoring across Brazil's 27 states
- Search, document-type tabs and status filters
- Clear distinction between unavailable data and unmonitored services
- Local query history and caching
- Responsive interface with persistent light/dark theme
- Links to official SEFAZ and SINTEGRA portals

## Tech stack

| Layer | Technology |
| --- | --- |
| Runtime / backend | Node.js 18+, JavaScript |
| Frontend | HTML, CSS, JavaScript |
| Testing | Built-in `node:test` |
| Container | Docker |
| Data sources | BrasilAPI, publica.cnpj.ws, TecnoSpeed SEFAZ Monitor |

## Quick start

```bash
git clone https://github.com/JoaoMalkiewiez/Radar-fiscal.git
cd Radar-fiscal/Sitezino
npm start
```

Open **http://localhost:5500**.

This application has no external npm dependencies in its current package manifest.

### Run tests

```bash
cd Sitezino
npm test
```

The test suite covers HTTP behavior, security headers, gzip compression, health checks, CNPJ validation, SEO and rate limiting. Tests do not require live third-party services.

### Docker

Run from the application directory:

```bash
cd Sitezino
docker build -t radar-fiscal .
docker run --rm -p 5500:5500 radar-fiscal
```

### Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `5500` |
| `HOST` | Listen interface; defaults to `0.0.0.0` |
| `PUBLIC_URL` | Public URL for sitemap and robots metadata |
| `TRUST_PROXY=1` | Trust reverse-proxy forwarded headers when appropriately configured |

## Architecture

```text
Browser (HTML/CSS/JavaScript)
       |
       v
Node.js server (Sitezino/server.js)
       |-- /api/cnpj --------> BrasilAPI / publica.cnpj.ws
       |-- /api/sefaz-status -> TecnoSpeed SEFAZ Monitor
       +-- /api/health ------> Health check
```

The Node.js backend handles external API requests, response normalization and caching. In particular, the SEFAZ monitor requires the backend proxy because the upstream source does not expose browser-compatible CORS headers.

## Documentation

- [Detailed application documentation](Sitezino/README.md)
- [Radar Jurídico setup](Sitezino/RADAR_JURIDICO_SETUP.md)
- [Radar Jurídico roadmap](Sitezino/RADAR_JURIDICO_ROADMAP.md)
- [SERPRO CPF setup](Sitezino/SERPRO_CPF_SETUP.md)

## Project status and disclaimer

Radar Fiscal is an **independent project**, not affiliated with Receita Federal, SEFAZ or TecnoSpeed. Information is provided for reference; verify critical fiscal decisions against official sources.

Radar Jurídico remains under development. Do not commit credentials, sensitive records or customer information.

## Author

**João Vitor Soares Malkiewiez** · [GitHub](https://github.com/JoaoMalkiewiez) · [LinkedIn](https://www.linkedin.com/in/joao-malkiewiez-a24486297)
