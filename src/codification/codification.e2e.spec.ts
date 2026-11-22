import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { CodificationStatus, Gender, Role } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { CodificationModule } from './codification.module';

const jwtSecret = 'test-secret-that-is-long-enough-for-jwt-signing';
const DOC_ID = '11111111-1111-4111-8111-111111111111';
const BED_ID = '22222222-2222-4222-8222-222222222222';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function makeUser(id: string, role: Role) {
  return {
    id,
    studentNumber: role === Role.STUDENT ? `num-${id}` : null,
    lastName: 'Test',
    firstName: id,
    email: `${id}@example.com`,
    role,
    gender: Gender.FEMALE,
    codificationStatus: CodificationStatus.NOT_STARTED,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('Codification HTTP endpoints (access control)', () => {
  let app: INestApplication;
  let baseUrl: string;
  let jwtService: JwtService;
  let tmpDir: string;
  const users = new Map(
    [
      makeUser('owner', Role.STUDENT),
      makeUser('other', Role.STUDENT),
      makeUser('admin', Role.ADMIN),
      makeUser('controller', Role.CONTROLLER),
    ].map((user) => [user.id, user]),
  );

  const prismaMock = {
    user: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      ),
    },
    document: {
      findUnique: vi.fn(async () => ({
        id: DOC_ID,
        userId: 'owner',
        filePath: path.join(tmpDir, 'uploads', 'documents', 'owner', 'cni.png'),
        fileName: 'cni.png',
        mimeType: 'image/png',
      })),
      findMany: vi.fn(async () => []),
    },
    bed: { findMany: vi.fn(async (...args: unknown[]) => (args.length ? [] : [])) },
  };

  const tokenFor = (id: string) => jwtService.signAsync({ sub: id });
  const call = async (
    method: string,
    route: string,
    userId?: string,
    init: RequestInit = {},
  ) => {
    const headers = new Headers(init.headers);
    if (userId) headers.set('authorization', `Bearer ${await tokenFor(userId)}`);
    return fetch(`${baseUrl}${route}`, { ...init, method, headers });
  };
  const json = (body: unknown): RequestInit => ({
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codif-e2e-'));
    fs.mkdirSync(path.join(tmpDir, 'uploads', 'documents', 'owner'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'uploads', 'documents', 'owner', 'cni.png'), PNG);
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ JWT_SECRET: jwtSecret })],
        }),
        PrismaModule,
        AuthModule,
        CodificationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
    jwtService = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const routes: Array<[string, string, RequestInit?]> = [
    ['POST', '/codification/import'],
    ['POST', '/codification/verify', json({ studentNumber: '1', birthDate: '2000-01-01' })],
    ['POST', '/codification/upload-documents'],
    ['GET', '/codification/admin/documents'],
    ['PATCH', `/codification/admin/documents/${DOC_ID}/validate`, json({ status: 'APPROVED' })],
    ['GET', `/codification/documents/${DOC_ID}/download`],
    ['GET', '/codification/beds'],
    ['GET', '/codification/me'],
    ['POST', `/codification/beds/${BED_ID}/reserve`],
  ];

  it.each(routes)('%s %s requires a valid token', async (method, route, init) => {
    const response = await call(method, route, undefined, init);
    expect(response.status).toBe(401);
  });

  it('keeps administrator routes away from students and controllers', async () => {
    const adminRoutes = routes.filter(([, route]) =>
      ['/codification/import', '/codification/admin'].some((prefix) => route.startsWith(prefix)),
    );
    expect(adminRoutes).toHaveLength(3);

    for (const [method, route, init] of adminRoutes) {
      for (const userId of ['owner', 'controller']) {
        const response = await call(method, route, userId, init);
        expect(response.status, `${method} ${route} as ${userId}`).toBe(403);
      }
    }
    expect((await call('GET', '/codification/admin/documents', 'admin')).status).toBe(200);
  });

  it('keeps student-only actions away from administrators and controllers', async () => {
    for (const userId of ['admin', 'controller']) {
      expect((await call('POST', `/codification/beds/${BED_ID}/reserve`, userId)).status).toBe(403);
      expect((await call('POST', '/codification/upload-documents', userId)).status).toBe(403);
    }
    expect((await call('GET', '/codification/beds', 'controller')).status).toBe(403);
  });

  it('downloads a document only for its owner or an administrator, and ignores ?isAdmin=true', async () => {
    const url = `/codification/documents/${DOC_ID}/download`;

    const ownerResponse = await call('GET', url, 'owner');
    expect(ownerResponse.status).toBe(200);
    expect(ownerResponse.headers.get('content-type')).toContain('image/png');
    expect(ownerResponse.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await ownerResponse.arrayBuffer())).toEqual(PNG);

    expect((await call('GET', url, 'admin')).status).toBe(200);

    const spoofed = await call(
      'GET',
      `${url}?isAdmin=true&studentNumber=${users.get('owner')!.studentNumber}`,
      'other',
    );
    expect(spoofed.status).toBe(403);
    expect((await call('GET', '/codification/documents/not-a-uuid/download', 'owner')).status).toBe(400);
  });

  it('refuses a QR-code token as an API access token', async () => {
    const qrToken = await jwtService.signAsync(
      { sub: 'owner', purpose: 'meal-scan' },
      { expiresIn: 300 },
    );
    const response = await fetch(`${baseUrl}/codification/beds`, {
      headers: { authorization: `Bearer ${qrToken}` },
    });
    expect(response.status).toBe(401);
  });

  it('forces students to see only the pavilions of their own gender', async () => {
    prismaMock.bed.findMany.mockClear();
    const response = await call('GET', '/codification/beds?gender=MALE', 'owner');
    expect(response.status).toBe(200);
    const query = prismaMock.bed.findMany.mock.calls[0]![0] as {
      where: { room: { pavilion: { gender: Gender } } };
    };
    expect(query.where.room.pavilion.gender).toBe(Gender.FEMALE);
  });
});
