import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  MealService,
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
  let module: TestingModule;

  beforeEach(async () => {
    wallet = { id: 'wallet-1', balance: 0 };
    transactions = [];
    tickets = [];

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
    };

    const prismaMock = {
      wallet: {
        upsert: vi.fn(async () => wallet),
      },
      transaction: transactionClient.transaction,
      ticket: transactionClient.ticket,
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
});
