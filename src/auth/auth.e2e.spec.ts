import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { CodificationStatus, Gender, Role, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthModule } from './auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

const jwtSecret = 'test-secret-that-is-long-enough-for-jwt-signing';

describe('Auth HTTP endpoints', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  const users = new Map<
    string,
    {
      id: string;
      studentNumber: string | null;
      lastName: string;
      firstName: string;
      email: string;
      passwordHash: string;
      role: Role;
      gender: Gender;
      codificationStatus: CodificationStatus;
      createdAt: Date;
      updatedAt: Date;
    }
  >();

  const prismaMock = {
    user: {
      findUnique: vi.fn(
        async ({ where }: Prisma.UserFindUniqueArgs) =>
          [...users.values()].find(
            (user) =>
              (where.id !== undefined && user.id === where.id) ||
              (where.email !== undefined && user.email === where.email),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: Prisma.UserCreateArgs) => {
        const user = {
          id: randomUUID(),
          studentNumber: data.studentNumber ?? null,
          lastName: data.lastName,
          firstName: data.firstName,
          email: data.email,
          passwordHash: data.passwordHash,
          role: data.role ?? Role.STUDENT,
          gender: data.gender,
          codificationStatus:
            data.codificationStatus ?? CodificationStatus.NOT_STARTED,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        users.set(user.id, user);
        return {
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
      }),
    },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: jwtSecret })],
        }),
        PrismaModule,
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.listen(0);
    baseUrl = await app.getUrl();
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers students safely and authenticates them with a JWT', async () => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Awa',
        lastName: 'Diop',
        email: 'AWA.DIOP@example.com',
        password: 'a-strong-password-123',
        gender: Gender.FEMALE,
        role: Role.ADMIN,
      }),
    });

    expect(response.status).toBe(201);
    const user = await response.json();
    expect(user).toMatchObject({
      firstName: 'Awa',
      lastName: 'Diop',
      email: 'awa.diop@example.com',
      role: Role.STUDENT,
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(users.get(user.id)?.passwordHash).not.toBe('a-strong-password-123');

    const invalidResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'awa.diop@example.com',
        password: 'wrong-password-123',
      }),
    });
    expect(invalidResponse.status).toBe(401);

    const loginResponse = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'AWA.DIOP@example.com',
        password: 'a-strong-password-123',
      }),
    });

    expect(loginResponse.status).toBe(200);
    const result = await loginResponse.json();
    expect(result).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 3600,
      user: { email: 'awa.diop@example.com', role: Role.STUDENT },
    });
    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('rejects missing JWTs and users without the required role', async () => {
    const noTokenResponse = await fetch(`${baseUrl}/auth/admin`);
    expect(noTokenResponse.status).toBe(401);

    const malformedToken = await jwtService.signAsync({
      email: 'awa@example.com',
    });
    const malformedResponse = await fetch(`${baseUrl}/auth/admin`, {
      headers: { authorization: `Bearer ${malformedToken}` },
    });
    expect(malformedResponse.status).toBe(401);

    const student = {
      id: 'student-id',
      studentNumber: '20250001',
      lastName: 'Diop',
      firstName: 'Awa',
      email: 'awa@example.com',
      passwordHash: 'not-used-by-strategy',
      role: Role.STUDENT,
      gender: Gender.FEMALE,
      codificationStatus: CodificationStatus.NOT_STARTED,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    users.set(student.id, student);
    const studentToken = await jwtService.signAsync({ sub: student.id });
    const forbiddenResponse = await fetch(`${baseUrl}/auth/admin`, {
      headers: { authorization: `Bearer ${studentToken}` },
    });
    expect(forbiddenResponse.status).toBe(403);

    const admin = { ...student, id: 'admin-id', role: Role.ADMIN };
    users.set(admin.id, admin);
    const adminToken = await jwtService.signAsync({ sub: admin.id });
    const allowedResponse = await fetch(`${baseUrl}/auth/admin`, {
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(allowedResponse.status).toBe(200);
  });

  it('does not store an unverified student number at registration', async () => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Ibou',
        lastName: 'Fall',
        email: 'ibou.fall@example.com',
        password: 'a-strong-password-123',
        gender: Gender.MALE,
        studentNumber: '20269999',
      }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ studentNumber: null });
  });

  it('refuses the short-lived QR token as an API access token', async () => {
    users.set('qr-student', {
      id: 'qr-student',
      studentNumber: null,
      lastName: 'Diop',
      firstName: 'Awa',
      email: 'qr@example.com',
      passwordHash: 'not-used-by-strategy',
      role: Role.STUDENT,
      gender: Gender.FEMALE,
      codificationStatus: CodificationStatus.NOT_STARTED,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const accessToken = await jwtService.signAsync({ sub: 'qr-student' });
    const qrToken = await jwtService.signAsync(
      { sub: 'qr-student', purpose: 'meal-scan' },
      { expiresIn: 300 },
    );

    const ok = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const refused = await fetch(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${qrToken}` },
    });
    expect(ok.status).toBe(200);
    expect(refused.status).toBe(401);
  });

  it('lets only an administrator create controller and admin accounts', async () => {
    const body = JSON.stringify({
      firstName: 'Moussa',
      lastName: 'Ndiaye',
      email: 'moussa.controleur@example.com',
      password: 'a-strong-password-123',
      gender: Gender.MALE,
      role: Role.CONTROLLER,
    });
    const headers = (token?: string) => ({
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    });
    const base = {
      lastName: 'Diop',
      firstName: 'Awa',
      passwordHash: 'x',
      gender: Gender.FEMALE,
      codificationStatus: CodificationStatus.NOT_STARTED,
      createdAt: new Date(),
      updatedAt: new Date(),
      studentNumber: null,
    };
    users.set('staff-student', { ...base, id: 'staff-student', email: 's@example.com', role: Role.STUDENT });
    users.set('staff-admin', { ...base, id: 'staff-admin', email: 'a@example.com', role: Role.ADMIN });

    const anonymous = await fetch(`${baseUrl}/auth/staff`, { method: 'POST', headers: headers(), body });
    const asStudent = await fetch(`${baseUrl}/auth/staff`, {
      method: 'POST',
      headers: headers(await jwtService.signAsync({ sub: 'staff-student' })),
      body,
    });
    const asAdmin = await fetch(`${baseUrl}/auth/staff`, {
      method: 'POST',
      headers: headers(await jwtService.signAsync({ sub: 'staff-admin' })),
      body,
    });
    const wrongRole = await fetch(`${baseUrl}/auth/staff`, {
      method: 'POST',
      headers: headers(await jwtService.signAsync({ sub: 'staff-admin' })),
      body: JSON.stringify({ ...JSON.parse(body), email: 'x@example.com', role: Role.STUDENT }),
    });

    expect(anonymous.status).toBe(401);
    expect(asStudent.status).toBe(403);
    expect(asAdmin.status).toBe(201);
    expect(await asAdmin.json()).toMatchObject({ role: Role.CONTROLLER });
    expect(wrongRole.status).toBe(400);
  });

  it('throttles repeated login attempts on the same account', async () => {
    const attempt = () =>
      fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'bruteforce@example.com', password: 'wrong-password-123' }),
      });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push((await attempt()).status);

    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  }, 30_000);
});
