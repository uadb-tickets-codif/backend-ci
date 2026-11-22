import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const RATE_LIMIT_KEY = 'rate-limit';
const MAX_TRACKED_KEYS = 5000;

export interface RateLimitOptions {
  /** Nombre de requêtes autorisées dans la fenêtre. */
  limit: number;
  /** Durée de la fenêtre, en millisecondes. */
  windowMs: number;
  /** Champ du corps de requête ajouté à la clé (ex. l'e-mail d'une connexion). */
  identifierField?: string;
}

export const RateLimit = (options: RateLimitOptions) =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Limiteur de débit en mémoire, sans dépendance externe.
 * La clé combine l'IP, l'utilisateur authentifié (s'il y en a un) et un
 * identifiant du corps de requête : derrière un proxy où toutes les IP sont
 * identiques, un utilisateur n'en bloque donc pas un autre.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<
    string,
    { timestamps: number[]; windowMs: number }
  >();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: { id?: string } }>();
    const body = (request.body ?? {}) as Record<string, unknown>;
    const identifier = options.identifierField
      ? String(body[options.identifierField] ?? '')
          .trim()
          .toLowerCase()
          .slice(0, 254)
      : '';
    const key = [
      context.getClass().name,
      context.getHandler().name,
      request.ip ?? 'unknown',
      request.user?.id ?? '',
      identifier,
    ].join('|');

    const now = Date.now();
    const entry = this.hits.get(key) ?? {
      timestamps: [],
      windowMs: options.windowMs,
    };
    entry.timestamps = entry.timestamps.filter(
      (timestamp) => now - timestamp < options.windowMs,
    );

    if (entry.timestamps.length >= options.limit) {
      this.hits.set(key, entry);
      throw new HttpException(
        'Trop de tentatives. Réessayez dans quelques minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    entry.timestamps.push(now);
    this.hits.delete(key);
    this.hits.set(key, entry);
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    if (this.hits.size <= MAX_TRACKED_KEYS) {
      return;
    }
    for (const [key, entry] of this.hits) {
      const newest = entry.timestamps[entry.timestamps.length - 1] ?? 0;
      if (now - newest >= entry.windowMs) {
        this.hits.delete(key);
      }
    }
    // Garde-fou : si tout est encore récent, on supprime les plus anciennes clés.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= MAX_TRACKED_KEYS) {
        break;
      }
      this.hits.delete(key);
    }
  }
}
