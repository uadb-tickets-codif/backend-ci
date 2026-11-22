# backend-ci

API REST de la plateforme **UADB Services** : gestion des **tickets de restauration** et de la **codification** (attribution des lits) pour les étudiants de l'Université Alioune Diop de Bambey.

Projet de l'examen pratique DevOps, Master 2 SI-SR, UADB, 2026-2027.

## Le projet en bref

Les étudiants achètent leurs repas en ligne et entrent au restaurant avec un QR code contrôlé par un agent. Ils effectuent aussi leur codification à distance : vérification de leur dossier, dépôt de leurs pièces, puis choix d'un lit. L'administration valide les dossiers et suit l'activité.

Le projet est réparti en trois dépôts Git, chacun avec son propre pipeline :

| Dépôt | Rôle | Image Docker Hub |
|---|---|---|
| **backend-ci** (ce dépôt) | API NestJS, CI backend | `groupe9/backend` |
| [frontend-ci](https://github.com/uadb-tickets-codif/frontend-ci) | Interface Next.js, CI frontend | `groupe9/frontend` |
| [deployment-cd](https://github.com/uadb-tickets-codif/deployment-cd) | Docker Compose, Jenkins, déploiement CD | n/a |

## Stack

NestJS 11, TypeScript, Prisma 6, PostgreSQL 16, Vitest, Docker, Jenkins, Trivy.

## Fonctionnalités

| Module | Contenu |
|---|---|
| **Authentification** | Inscription et connexion (limitées à 10 essais par 15 min et par compte), mots de passe hachés (bcrypt), jeton JWT, trois rôles : `STUDENT`, `CONTROLLER`, `ADMIN`. `POST /auth/staff` (administrateur) crée les comptes contrôleur et administrateur |
| **Portefeuille et tickets** | Solde en FCFA, recharge simulée, achat de tickets par service (petit-déjeuner 50 F, déjeuner 100 F, dîner 100 F), historique des transactions, tickets disponibles (`GET /tickets/available`) et repas pris (`GET /tickets/meals`) |
| **QR code et contrôle** | Jeton QR signé et renouvelable (il ne contient pas le solde), scan par le contrôleur, un repas par service et par jour. Au scan, un ticket déjà acheté pour ce service est consommé en priorité (`paymentMethod: TICKET`, sans second débit) ; sans ticket, le repas est débité du solde (`paymentMethod: WALLET`). Résultats : `OK`, `INSUFFICIENT_BALANCE`, `ALREADY_SERVED`, `INVALID_TOKEN`, `TICKET_NOT_FOUND` |
| **Codification** | Import CSV des étudiants codifiables (colonnes en anglais ou en français, genre M/F), vérification d'éligibilité qui rattache le matricule au compte, dépôt de la CNI et de la carte étudiante, validation ou rejet motivé par l'administrateur, consultation de son dossier (`GET /codification/me`), liste des lits et réservation |
| **Santé** | `GET /health` vérifie la connexion à PostgreSQL (200 si la base répond, 503 sinon) |

La liste exacte des routes, avec les corps de requête et de réponse, est dans **Swagger**.

## Prérequis

- Node.js 22 et npm
- Docker Desktop avec Docker Compose, ou un serveur PostgreSQL accessible

## Installation et démarrage local

```sh
npm ci
cp .env.example .env
docker compose up -d postgres
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

Sous PowerShell : remplacer `cp` par `Copy-Item`, et `npm` par `npm.cmd` si l'exécution de scripts est bloquée.

L'API écoute sur le port défini dans `.env` (3001 dans `.env.example`, 3000 si `PORT` n'est pas défini).

- Swagger : `http://localhost:3001/api` (document OpenAPI JSON sur `/api-json`)
- Santé : `http://localhost:3001/health`

Le `docker-compose.yml` de ce dépôt ne sert qu'au **développement local** (un seul service PostgreSQL 16). Le déploiement complet est décrit dans [deployment-cd](https://github.com/uadb-tickets-codif/deployment-cd). Pour arrêter la base locale : `docker compose down` (les données restent dans le volume `postgres16_data`).

## Variables d'environnement

Modèle dans `.env.example`. Le fichier `.env` n'est jamais versionné.

| Variable | Rôle | Exemple |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | `postgresql://user:password@localhost:5432/uadb` |
| `JWT_SECRET` | Clé de signature des jetons | à changer hors démonstration |
| `PORT` | Port d'écoute de l'API | `3001` |

## Commandes

| Commande | Description |
|---|---|
| `npm run start:dev` | Démarre l'API avec rechargement |
| `npm run build` | Compile dans `dist/` |
| `npm run start:prod` | Démarre la version compilée |
| `npm test` | Tests unitaires (Vitest) |
| `npm run lint` | Vérification ESLint |
| `npm run prisma:generate` | Génère le client Prisma |

Les tests unitaires suivent la convention NestJS : ils se trouvent à côté du code, dans `src/**/*.spec.ts`.

## Structure

```text
prisma/
  schema.prisma         Modèle de données
  migrations/           Migrations versionnées (appliquées par prisma migrate deploy)
src/
  auth/                 Authentification, JWT, rôles
  tickets/              Portefeuille, tickets, QR code, scan
  codification/         Import CSV, documents, pavillons, chambres, lits
  health/               Sonde /health
  prisma/               Service et module Prisma
  config/               Validation de l'environnement
  app.module.ts         Module racine
  main.ts               Démarrage, CORS, validation globale, Swagger
Dockerfile              Image de production (multi-étapes)
Jenkinsfile             Pipeline CI
```

## Modèle de données

| Table | Contenu |
|---|---|
| `users` | Comptes (rôle, genre, statut de codification) |
| `wallets`, `transactions` | Solde et mouvements |
| `tickets`, `meal_scans` | Tickets par service, journal des contrôles |
| `codifiable_students` | Liste importée par l'administration |
| `documents` | Pièces déposées et leur statut |
| `pavilions`, `rooms`, `beds`, `assignments` | Hébergement et affectations |

### Migrations Prisma : règles d'équipe

- Après chaque changement de `schema.prisma` : `npx prisma migrate dev --name description-courte`, puis commiter le dossier `prisma/migrations`.
- Ne jamais modifier ni supprimer une migration déjà fusionnée : en créer une nouvelle.
- Ne jamais lancer `prisma migrate reset` ailleurs qu'en local.
- Privilégier les changements additifs (ajouter une colonne plutôt que renommer) : pendant une mise à jour, l'ancienne et la nouvelle version de l'API tournent en même temps.

## Image Docker

Le `Dockerfile` construit l'image en deux étapes. Il compile l'application, génère le client Prisma, puis produit une image de production allégée qui s'exécute avec l'utilisateur `node`. Au démarrage, le conteneur applique les migrations (`prisma migrate deploy`) avant de lancer l'API. Les fichiers déposés par les étudiants sont écrits dans `/app/uploads`, monté sur un volume nommé en déploiement.

## Pipeline CI (Jenkins)

Le job est un *Multibranch Pipeline* : chaque push détecte la branche et lance le `Jenkinsfile`.

| Étape | Rôle |
|---|---|
| Checkout | Récupération du code |
| Installation et build | `npm ci` et compilation dans l'étape de build de l'image |
| Tests unitaires | Exécution des tests |
| Scan du code | `npm audit` |
| Build image Docker | Image `groupe9/backend:1.0.<n° de build>` et `latest` |
| Scan Trivy | Vulnérabilités de l'image (gravités HIGH et CRITICAL) |
| Push Docker Hub | Publication, avec le credential Jenkins `dockerhub-creds` |
| Déclencher le déploiement | Lance le job `deployment-cd` avec le tag construit |

Le push et le déclenchement du déploiement ne se font que sur les branches `develop` et `main`.

## Qualité et sécurité

- Mots de passe hachés avec bcrypt, jetons JWT, contrôle d'accès par rôle sur **toutes** les routes sauf `/health`, `/auth/register` et `/auth/login`. L'identité vient toujours du jeton, jamais du corps ni de l'URL de la requête.
- Le jeton du QR code (usage restreint, montré au contrôleur) est refusé comme jeton d'accès à l'API.
- Validation globale des requêtes (DTO), CORS configuré.
- Documents téléversés : type réel vérifié dans le contenu du fichier (PDF, JPG ou PNG), 5 Mo maximum, stockés hors de tout dossier public (`uploads/documents/<id du compte>/`), accessibles uniquement à l'étudiant concerné et à l'administration.
- Le numéro étudiant n'est rattaché à un compte qu'après la vérification d'éligibilité (matricule + date de naissance), pour éviter qu'on réserve le matricule d'un autre.
- Ne jamais versionner `uploads/` : il contient des pièces d'identité.

### Créer le premier administrateur

Les comptes `CONTROLLER` et `ADMIN` se créent via `POST /auth/staff`, réservé à un administrateur. Pour le tout premier : créer un compte étudiant normalement, puis le promouvoir en base :

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'admin@exemple.sn';
```
- Aucun secret dans le dépôt : seules des valeurs de démonstration figurent dans `.env.example`.
- `package-lock.json` toujours commité. En cas de conflit, ne pas le résoudre à la main : prendre une des deux versions, relancer `npm install`, puis vérifier avec `npm ci`.

## Branches et contributions

`main` (stable), `develop` (intégration), `feature/<tâche>` (une branche par carte Trello). Toute modification passe par une Pull Request relue par un autre membre.

## Équipe

| Membre | Rôle |
|---|---|
| Serigne Ismaila SOUANE | Backend : authentification, portefeuille, tickets, QR code |
| Ibrahima SYLLA | Backend : codification |
| Mamadou WADE | Frontend |
| Ibrahima WATT | Administration système : Dockerfiles, CI, sécurité des images |
| Mouhamadou Lamine COLY | Scrum master, administration système : Jenkins, CD, coordination |
