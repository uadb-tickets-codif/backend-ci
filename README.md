# backend-ci

API NestJS de la plateforme de gestion des tickets de restauration et de la
codification (UADB, Master 2 SI-SR).

## Stack

NestJS, Prisma, PostgreSQL, Docker, Jenkins

## Prérequis

- Node.js 22 ou supérieur et npm
- Docker Desktop avec Docker Compose, ou un serveur PostgreSQL accessible

## Installation et démarrage local

```sh
npm install
cp .env.example .env
docker compose up -d postgres
npm run prisma:generate
npm run start:dev
```

Le fichier `.env` configure `DATABASE_URL` et `PORT` (3001 par défaut dans
`.env.example`, 3000 si `PORT` n'est pas défini). PostgreSQL 16 est fourni par
Docker Compose. L'API est disponible sur le port configuré.

La sonde `GET /health` vérifie la connexion PostgreSQL : elle renvoie `200`
si la base est accessible, sinon `503`. Swagger est disponible sur
`http://localhost:3001/api` (ou le port configuré) et le document OpenAPI JSON
sur `/api-json`. CORS et la validation globale des requêtes sont activés.

Pour arrêter PostgreSQL, exécuter `docker compose down`. Les données restent
conservées dans le volume `postgres16_data`.

## Commandes

| Commande | Description |
| --- | --- |
| `npm run start:dev` | Démarre l'API en mode développement avec rechargement |
| `npm run build` | Compile l'application dans `dist/` |
| `npm run start:prod` | Démarre l'application compilée |
| `npm test` | Exécute les tests unitaires |
| `npm run lint` | Vérifie le style et les erreurs ESLint |
| `npm run prisma:generate` | Génère le client Prisma |
| `npm run prisma:push` | Synchronise le schéma Prisma avec PostgreSQL |

Les tests unitaires suivent la convention NestJS et se trouvent dans
`src/**/*.spec.ts`.

## Structure

```text
prisma/                 Schéma Prisma
src/
  auth/                 Module d'authentification
  tickets/              Module des tickets de restauration
  codification/         Module de codification
  health/               Sonde HTTP et vérification de PostgreSQL
  prisma/               Service et module Prisma
  app.module.ts         Module racine
  main.ts               Bootstrap, validation et Swagger
```

## Pipeline CI

Le pipeline Jenkins est à compléter.

## Dépôts liés

- frontend-ci
- deployment-cd

## Équipe

- Serigne Ismaila SOUANE
- Ibrahima SYLLA
- Ibrahima WATT
- Mamadou WADE
- Lamine Junior COLY
