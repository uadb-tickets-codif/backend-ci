import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Role } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser, PUBLIC_USER_SELECT } from './auth.constants';
import { PrismaService } from '../prisma/prisma.service';

interface JwtPayload {
  sub: string;
  // Présent uniquement sur les jetons à usage restreint (ex. QR code repas).
  purpose?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(
    payload: JwtPayload | null | undefined,
  ): Promise<AuthenticatedUser> {
    // Un jeton à usage restreint (QR code montré au contrôleur) ne doit jamais
    // servir de jeton d'accès à l'API.
    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.purpose !== undefined
    ) {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: PUBLIC_USER_SELECT,
    });

    if (!user || !Object.values(Role).includes(user.role)) {
      throw new UnauthorizedException('Invalid access token');
    }

    return user;
  }
}
