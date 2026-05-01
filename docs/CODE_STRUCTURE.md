# Code Structure

```text
.
|-- README.md
|-- package.json
|-- tsconfig.base.json
|-- apps
|   |-- api
|   |   |-- package.json
|   |   |-- tsconfig.json
|   |   |-- .env.example
|   |   |-- prisma
|   |   |   `-- schema.prisma
|   |   `-- src
|   |       |-- server.ts
|   |       |-- router.ts
|   |       |-- types.ts
|   |       |-- config
|   |       |   |-- env.ts
|   |       |   `-- prisma.ts
|   |       |-- middleware
|   |       |   |-- auth.ts
|   |       |   `-- rbac.ts
|   |       `-- modules
|   |           |-- auth/routes.ts
|   |           |-- companies/routes.ts
|   |           |-- workflow/routes.ts
|   |           |-- labor/routes.ts
|   |           `-- audit/routes.ts
|   `-- web
|       |-- package.json
|       |-- tsconfig.json
|       |-- next.config.mjs
|       |-- .env.example
|       `-- app/page.tsx
|-- packages
|   `-- shared
|       |-- package.json
|       |-- tsconfig.json
|       `-- src/index.ts
|-- automation
|   `-- crewai
|       |-- requirements.txt
|       |-- README.md
|       |-- config
|       |   |-- agents.yaml
|       |   `-- tasks.yaml
|       `-- src/main.py
|-- docs
|   |-- IMPLEMENTATION_PLAN.md
|   `-- CODE_STRUCTURE.md
`-- infrastructure
    |-- docker-compose.yml
    `-- CLOUD_DEPLOYMENT.md
```
