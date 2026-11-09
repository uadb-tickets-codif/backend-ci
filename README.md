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
# Définir JWT_SECRET dans .env avec une valeur générée par `openssl rand -base64 48`
# Compose du dépôt backend-ci : développement local uniquement
docker compose up -d postgres
npm run prisma:generate
npm run start:dev
```

Le fichier `.env` configure `DATABASE_URL` et `PORT` (3001 par défaut dans
`.env.example`, 3000 si `PORT` n'est pas défini). PostgreSQL 16 est fourni par
Docker Compose. Ce `compose.yaml` sert uniquement au développement local ; la
configuration Docker Compose de déploiement se trouve dans `deployment-cd`.
L'API est disponible sur le port configuré.

La sonde `GET /health` vérifie la connexion PostgreSQL : elle renvoie `200`
si la base est accessible, sinon `503`. Swagger est disponible sur
`http://localhost:3001/api` (ou le port configuré) et le document OpenAPI JSON
sur `/api-json`. CORS et la validation globale des requêtes sont activés.

## Authentification

Configurer `JWT_SECRET` dans `.env` avec une valeur aléatoire d'au moins
32 caractères (par exemple `openssl rand -base64 48`). `POST /auth/register`
crée un compte étudiant avec un mot de passe haché ; le rôle est toujours
`STUDENT` et ne peut pas être choisi à l'inscription. `POST /auth/login`
retourne un jeton Bearer JWT valable une heure. Utiliser
`Authorization: Bearer <token>` sur les routes protégées. `GET /auth/me`
requiert un jeton valide et `GET /auth/admin` requiert en plus le rôle `ADMIN`.
Les rôles disponibles sont `STUDENT`, `CONTROLLER` et `ADMIN`.

Pour arrêter PostgreSQL, exécuter `docker compose down`. Les données restent
conservées dans le volume `postgres16_data`.

## Commandes

| Commande                  | Description                                                                  |
| ------------------------- | ---------------------------------------------------------------------------- |
| `npm run start:dev`       | Démarre l'API en mode développement avec rechargement                        |
| `npm run build`           | Compile l'application dans `dist/`                                           |
| `npm run start:prod`      | Démarre l'application compilée                                               |
| `npm test`                | Exécute les tests unitaires                                                  |
| `npm run lint`            | Vérifie le style et les erreurs ESLint                                       |
| `npm run prisma:generate` | Génère le client Prisma                                                      |
| `npm run prisma:migrate`  | Crée et applique une migration en développement (`prisma migrate dev`)       |
| `npm run prisma:deploy`   | Applique les migrations versionnées au déploiement (`prisma migrate deploy`) |
| `npm run prisma:push`     | Synchronise directement le schéma, réservé aux essais locaux                 |

Utiliser les migrations pour tout changement partagé : créer les migrations
avec `npm run prisma:migrate`, puis versionner `prisma/migrations/` avec le
changement de schéma. Le déploiement les applique via `prisma migrate deploy`.
Ne pas utiliser `prisma:push` pour des changements partagés. Le dossier
`prisma/migrations/` est versionné ; versionner chaque migration SQL générée.

Les tests unitaires suivent la convention NestJS et se trouvent dans
`src/**/*.spec.ts`.

## Structure

```text
prisma/                 Schéma Prisma et migrations versionnées
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
