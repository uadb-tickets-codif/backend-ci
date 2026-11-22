import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Gender, Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import {
  BCRYPT_SALT_ROUNDS,
  JWT_ACCESS_TOKEN_TTL_SECONDS,
  PUBLIC_USER_SELECT,
} from './auth.constants';
import { CreateStaffDto } from './dto/create-staff.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { PrismaService } from '../prisma/prisma.service';

interface NewUserInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  gender: Gender;
}

@Injectable()
export class AuthService {
  // Hash factice : évite de révéler par le temps de réponse qu'un e-mail n'existe pas.
  private dummyHash?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Inscription étudiante. Le numéro étudiant n'est volontairement pas enregistré
   * ici : n'importe qui pourrait réserver le matricule d'un autre. Il est rattaché
   * au compte par POST /codification/verify, qui exige aussi la date de naissance.
   */
  register(dto: RegisterDto) {
    return this.createUser(dto, Role.STUDENT);
  }

  /** Création d'un compte contrôleur ou administrateur par un administrateur. */
  createStaff(dto: CreateStaffDto) {
    return this.createUser(dto, dto.role);
  }

  private async createUser(input: NewUserInput, role: Role) {
    if (Buffer.byteLength(input.password, 'utf8') > 72) {
      throw new BadRequestException(
        'Le mot de passe doit faire 72 octets au maximum.',
      );
    }

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);

    try {
      return await this.prisma.user.create({
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          email: input.email.trim().toLowerCase(),
          passwordHash,
          gender: input.gender,
          role,
        },
        select: PUBLIC_USER_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Cette adresse e-mail est déjà utilisée.');
      }

      throw error;
    }
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.trim().toLowerCase() },
    });

    const passwordTooLong = Buffer.byteLength(dto.password, 'utf8') > 72;
    const passwordMatches = passwordTooLong
      ? false
      : await bcrypt.compare(
          dto.password,
          user?.passwordHash ?? (await this.getDummyHash()),
        );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Adresse e-mail ou mot de passe invalide.');
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

  private async getDummyHash(): Promise<string> {
    this.dummyHash ??= await bcrypt.hash(
      'mot-de-passe-factice',
      BCRYPT_SALT_ROUNDS,
    );
    return this.dummyHash;
  }
}
