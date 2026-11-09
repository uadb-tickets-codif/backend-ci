import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  BCRYPT_SALT_ROUNDS,
  JWT_ACCESS_TOKEN_TTL_SECONDS,
  PUBLIC_USER_SELECT,
} from './auth.constants';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    if (Buffer.byteLength(dto.password, 'utf8') > 72) {
      throw new BadRequestException('Password must be at most 72 bytes');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_SALT_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          email: dto.email.trim().toLowerCase(),
          passwordHash,
          gender: dto.gender,
          studentNumber: dto.studentNumber?.trim(),
          role: Role.STUDENT,
        },
        select: PUBLIC_USER_SELECT,
      });

      return user;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Email or student number already exists');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    if (
      !user ||
      Buffer.byteLength(dto.password, 'utf8') > 72 ||
      !(await bcrypt.compare(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const safeUser = {
      id: user.id,
      studentNumber: user.studentNumber,
      lastName: user.lastName,
      firstName: user.firstName,
      email: user.email,
      role: user.role,
      gender: user.gender,
      codificationStatus: user.codificationStatus,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: JWT_ACCESS_TOKEN_TTL_SECONDS,
      user: safeUser,
    };
  }
}
