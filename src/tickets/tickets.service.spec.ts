import { BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  MealService,
  Role,
  ScanResult,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../prisma/prisma.service';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  let service: TicketsService;
  let wallet: { id: string; balance: number };
  let transactions: Array<Record<string, unknown>>;
  let tickets: Array<Record<string, unknown>>;
  let scans: Array<Record<string, unknown>>;
  let jwtService: JwtService;
  let module: TestingModule;

  beforeEach(async () => {
    wallet = { id: 'wallet-1', balance: 0 };
    transactions = [];
    tickets = [];
    scans = [];
    jwtService = new JwtService({
      secret: 'test-secret-that-is-long-enough-for-jwt-signing',
    });

    const transactionClient = {
      wallet: {
        update: vi.fn(
          async ({ data }: { data: { balance: { increment: number } } }) => {
            wallet.balance += data.balance.increment;
            return wallet;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: { balance: { gte: number } };
            data: { balance: { decrement: number } };
          }) => {
            if (wallet.balance < where.balance.gte) {
              return { count: 0 };
            }
            wallet.balance -= data.balance.decrement;
            return { count: 1 };
          },
        ),
        findUniqueOrThrow: vi.fn(async () => ({ balance: wallet.balance })),
      },
      transaction: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const transaction = {
            id: `transaction-${transactions.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          transactions.push(transaction);
          return transaction;
        }),
        findMany: vi.fn(async () => transactions),
      },
      ticket: {
        createManyAndReturn: vi.fn(
          async ({
            data,
          }: {
            data: Array<{ studentId: string; service: MealService }>;
          }) => {
            const createdTickets = data.map((ticket, index) => ({
              id: `ticket-${tickets.length + index + 1}`,
              status: 'UNUSED',
              ...ticket,
            }));
            tickets.push(...createdTickets);
            return createdTickets;
          },
        ),
      },
      mealScan: {
        findFirst: vi.fn(
          async ({
            where,
          }: {
            where: {
              studentId: string;
              service: MealService;
              date: Date;
              result: ScanResult;
            };
          }) =>
            scans.find(
              (scan) =>
                scan.studentId === where.studentId &&
                scan.service === where.service &&
                (scan.date as Date).getTime() === where.date.getTime() &&
                scan.result === where.result,
            ) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const scan = { id: `scan-${scans.length + 1}`, ...data };
          scans.push(scan);
          return scan;
        }),
      },
    };

    const prismaMock = {
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'student-1'
            ? { id: 'student-1', role: Role.STUDENT }
            : null,
        ),
      },
      wallet: {
        upsert: vi.fn(async () => wallet),
        findUniqueOrThrow: vi.fn(async () => ({ balance: wallet.balance })),
      },
      transaction: transactionClient.transaction,
      ticket: transactionClient.ticket,
      mealScan: transactionClient.mealScan,
      $transaction: vi.fn(
        async (
          callback: (client: typeof transactionClient) => Promise<unknown>,
        ) => callback(transactionClient),
      ),
    };

    module = await Test.createTestingModule({
      providers: [
        TicketsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();
    service = module.get(TicketsService);
  });

  it('returns the configured meal prices in XOF', () => {
    expect(service.getPrices()).toEqual({
      currency: 'XOF',
      prices: {
        [MealService.BREAKFAST]: 50,
        [MealService.LUNCH]: 100,
        [MealService.DINNER]: 100,
      },
    });
  });

  it('credits successful top-ups and leaves the balance unchanged on failure', async () => {
    const successfulTopUp = await service.topUp('student-1', { amount: 500 });
    const failedTopUp = await service.topUp('student-1', {
      amount: 250,
      simulateFailure: true,
    });

    expect(successfulTopUp.balance).toBe(500);
    expect(successfulTopUp.transaction).toMatchObject({
      amount: 500,
      status: TransactionStatus.SUCCESS,
      type: TransactionType.CREDIT,
    });
    expect(failedTopUp.balance).toBe(500);
    expect(failedTopUp.transaction).toMatchObject({
      amount: 250,
      status: TransactionStatus.FAILED,
      type: TransactionType.CREDIT,
    });
    await expect(service.getWallet('student-1')).resolves.toEqual({
      balance: 500,
      currency: 'XOF',
    });
    await expect(service.getTransactions('student-1')).resolves.toHaveLength(2);
  });

  it('debits successful ticket purchases and records failed payments', async () => {
    await service.topUp('student-1', { amount: 500 });
    const purchase = await service.purchase('student-1', {
      service: MealService.LUNCH,
      quantity: 2,
    });
    const failedPurchase = await service.purchase('student-1', {
      service: MealService.DINNER,
      quantity: 1,
      simulateFailure: true,
    });

    expect(purchase).toMatchObject({
      balance: 300,
      pricePerTicket: 100,
      transaction: {
        amount: 200,
        status: TransactionStatus.SUCCESS,
        type: TransactionType.DEBIT,
      },
      tickets: [
        { service: MealService.LUNCH, status: 'UNUSED' },
        { service: MealService.LUNCH, status: 'UNUSED' },
      ],
    });
    expect(failedPurchase).toMatchObject({
      balance: 300,
      transaction: {
        amount: 100,
        status: TransactionStatus.FAILED,
        type: TransactionType.DEBIT,
      },
      tickets: [],
    });
    expect(tickets).toHaveLength(2);
  });

  it('rejects purchases that exceed the available balance', async () => {
    await expect(
      service.purchase('student-1', {
        service: MealService.BREAKFAST,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(wallet.balance).toBe(0);
    expect(transactions).toHaveLength(0);
  });

  it('does not impose an arbitrary purchase quantity cap', async () => {
    await service.topUp('student-1', { amount: 5050 });
    const purchase = await service.purchase('student-1', {
      service: MealService.BREAKFAST,
      quantity: 101,
    });

    expect(purchase.tickets).toHaveLength(101);
    expect(purchase.balance).toBe(0);
  });

  it('returns the transaction history in reverse chronological order', async () => {
    await service.topUp('student-1', { amount: 100 });

    await expect(service.getTransactions('student-1')).resolves.toMatchObject([
      { amount: 100, currency: 'XOF', type: TransactionType.CREDIT },
    ]);
  });

  it('issues a renewable signed QR token with a five-minute expiry', async () => {
    const first = await service.createQrToken('student-1');
    const second = await service.createQrToken('student-1');
    const payload = await jwtService.verifyAsync<{
      sub: string;
      purpose: string;
    }>(first.qrToken);

    expect(first.expiresIn).toBe(300);
    expect(first.qrToken).not.toBe(second.qrToken);
    expect(payload).toMatchObject({
      sub: 'student-1',
      purpose: 'meal-scan',
    });
  });

  it('accepts a valid scan, debits the meal price and logs it', async () => {
    await service.topUp('student-1', { amount: 500 });
    const { qrToken } = await service.createQrToken('student-1');

    const result = await service.scan('controller-1', {
      qrToken,
      service: MealService.LUNCH,
    });

    expect(result).toMatchObject({
      result: ScanResult.OK,
      amount: 100,
      balance: 400,
    });
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({
      studentId: 'student-1',
      controllerId: 'controller-1',
      service: MealService.LUNCH,
      result: ScanResult.OK,
    });
    expect(transactions.at(-1)).toMatchObject({
      type: TransactionType.DEBIT,
      status: TransactionStatus.SUCCESS,
      amount: 100,
    });
  });

  it('records an insufficient-balance scan without debiting', async () => {
    const { qrToken } = await service.createQrToken('student-1');

    const result = await service.scan('controller-1', {
      qrToken,
      service: MealService.DINNER,
    });

    expect(result).toMatchObject({
      result: ScanResult.INSUFFICIENT_BALANCE,
      balance: 0,
    });
    expect(wallet.balance).toBe(0);
    expect(scans[0]).toMatchObject({
      result: ScanResult.INSUFFICIENT_BALANCE,
    });
  });

  it('prevents a second serving for the same service and day', async () => {
    await service.topUp('student-1', { amount: 500 });
    const { qrToken } = await service.createQrToken('student-1');
    const first = await service.scan('controller-1', {
      qrToken,
      service: MealService.BREAKFAST,
    });
    const second = await service.scan('controller-1', {
      qrToken,
      service: MealService.BREAKFAST,
    });

    expect(first).toMatchObject({ result: ScanResult.OK, balance: 450 });
    expect(second).toMatchObject({
      result: ScanResult.ALREADY_SERVED,
      balance: 450,
    });
    expect(wallet.balance).toBe(450);
    expect(scans.map((scan) => scan.result)).toEqual([
      ScanResult.OK,
      ScanResult.ALREADY_SERVED,
    ]);
  });

  it('rejects and journals an invalid QR token', async () => {
    const result = await service.scan('controller-1', {
      qrToken: 'not-a-valid-token',
      service: MealService.LUNCH,
    });

    expect(result).toMatchObject({
      result: ScanResult.INVALID_TOKEN,
      message: expect.stringContaining('invalide'),
    });
    expect(scans[0]).toMatchObject({
      controllerId: 'controller-1',
      result: ScanResult.INVALID_TOKEN,
    });
    expect(scans[0]).not.toHaveProperty('studentId');
  });
});
