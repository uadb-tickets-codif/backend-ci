import { ServiceUnavailableException } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: { $queryRaw: ReturnType<typeof vi.fn> };
  let module: TestingModule;

  beforeEach(async () => {
    prisma = {
      $queryRaw: vi.fn(),
    };

    module = await Test.createTestingModule({
      imports: [TerminusModule],
      providers: [HealthService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(HealthService);
  });

  it('reports the API and database as available', async () => {
    prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    await expect(service.check()).resolves.toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
    });
  });

  it('returns service unavailable when PostgreSQL cannot be reached', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('Connection refused'));

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
