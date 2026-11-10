import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  Prisma,
  Role,
  ScanResult,
  TransactionStatus,
  TransactionType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseTicketDto } from './dto/purchase-ticket.dto';
import { ScanMealDto } from './dto/scan-meal.dto';
import { TopUpDto } from './dto/top-up.dto';
import { MEAL_PRICES_XOF } from './tickets.constants';

const CURRENCY = 'XOF';
const QR_TOKEN_TTL_SECONDS = 300;
const QR_TOKEN_PURPOSE = 'meal-scan';

interface MealQrPayload {
  sub: string;
  purpose: string;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async getWallet(userId: string) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { balance: true },
    });

    return { balance: wallet.balance, currency: CURRENCY };
  }

  getPrices() {
    return { currency: CURRENCY, prices: MEAL_PRICES_XOF };
  }

  async createQrToken(studentId: string) {
    const token = await this.jwtService.signAsync(
      { sub: studentId, purpose: QR_TOKEN_PURPOSE },
      { expiresIn: QR_TOKEN_TTL_SECONDS, jwtid: randomUUID() },
    );

    return {
      qrToken: token,
      tokenType: 'Bearer',
      expiresIn: QR_TOKEN_TTL_SECONDS,
      expiresAt: new Date(Date.now() + QR_TOKEN_TTL_SECONDS * 1000),
    };
  }

  async scan(controllerId: string, dto: ScanMealDto) {
    const serviceDate = new Date();
    serviceDate.setUTCHours(0, 0, 0, 0);

    let payload: MealQrPayload;
    try {
      payload = await this.jwtService.verifyAsync<MealQrPayload>(dto.qrToken);
    } catch (error) {
      if (
        error instanceof Error &&
        ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(
          error.name,
        )
      ) {
        await this.prisma.mealScan.create({
          data: {
            controllerId,
            service: dto.service,
            date: serviceDate,
            result: ScanResult.INVALID_TOKEN,
          },
        });
        return {
          result: ScanResult.INVALID_TOKEN,
          message: 'QR code invalide ou expiré.',
        };
      }

      throw error;
    }

    if (
      !payload ||
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.purpose !== QR_TOKEN_PURPOSE
    ) {
      await this.prisma.mealScan.create({
        data: {
          controllerId,
          service: dto.service,
          date: serviceDate,
          result: ScanResult.INVALID_TOKEN,
        },
      });
      return {
        result: ScanResult.INVALID_TOKEN,
        message: 'QR code invalide ou expiré.',
      };
    }

    const student = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true },
    });
    if (!student || student.role !== Role.STUDENT) {
      await this.prisma.mealScan.create({
        data: {
          controllerId,
          service: dto.service,
          date: serviceDate,
          result: ScanResult.INVALID_TOKEN,
        },
      });
      return {
        result: ScanResult.INVALID_TOKEN,
        message: 'QR code invalide ou expiré.',
      };
    }

    const wallet = await this.prisma.wallet.upsert({
      where: { userId: student.id },
      create: { userId: student.id },
      update: {},
      select: { id: true },
    });
    const amount = MEAL_PRICES_XOF[dto.service];

    try {
      return await this.prisma.$transaction(async (transactionClient) => {
        const previousScan = await transactionClient.mealScan.findFirst({
          where: {
            studentId: student.id,
            service: dto.service,
            date: serviceDate,
            result: ScanResult.OK,
          },
        });

        if (previousScan) {
          await transactionClient.mealScan.create({
            data: {
              studentId: student.id,
              controllerId,
              service: dto.service,
              date: serviceDate,
              result: ScanResult.ALREADY_SERVED,
            },
          });
          const currentWallet =
            await transactionClient.wallet.findUniqueOrThrow({
              where: { id: wallet.id },
              select: { balance: true },
            });
          return {
            result: ScanResult.ALREADY_SERVED,
            message: 'Cet étudiant a déjà été servi pour ce repas aujourd’hui.',
            balance: currentWallet.balance,
            currency: CURRENCY,
          };
        }

        const debit = await transactionClient.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });
        if (debit.count === 0) {
          await transactionClient.mealScan.create({
            data: {
              studentId: student.id,
              controllerId,
              service: dto.service,
              date: serviceDate,
              result: ScanResult.INSUFFICIENT_BALANCE,
            },
          });
          const currentWallet =
            await transactionClient.wallet.findUniqueOrThrow({
              where: { id: wallet.id },
              select: { balance: true },
            });
          return {
            result: ScanResult.INSUFFICIENT_BALANCE,
            message: 'Solde insuffisant pour ce repas.',
            balance: currentWallet.balance,
            amount,
            currency: CURRENCY,
          };
        }

        await transactionClient.transaction.create({
          data: {
            walletId: wallet.id,
            type: TransactionType.DEBIT,
            status: TransactionStatus.SUCCESS,
            amount,
          },
        });
        const scan = await transactionClient.mealScan.create({
          data: {
            studentId: student.id,
            controllerId,
            service: dto.service,
            date: serviceDate,
            result: ScanResult.OK,
          },
        });
        const updatedWallet =
          await transactionClient.wallet.findUniqueOrThrow({
            where: { id: wallet.id },
            select: { balance: true },
          });

        return {
          result: ScanResult.OK,
          message: 'Repas validé. Bon appétit !',
          scanId: scan.id,
          balance: updatedWallet.balance,
          amount,
          currency: CURRENCY,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const successfulScan = await this.prisma.mealScan.findFirst({
          where: {
            studentId: student.id,
            service: dto.service,
            date: serviceDate,
            result: ScanResult.OK,
          },
        });
        if (!successfulScan) {
          throw error;
        }

        await this.prisma.mealScan.create({
          data: {
            studentId: student.id,
            controllerId,
            service: dto.service,
            date: serviceDate,
            result: ScanResult.ALREADY_SERVED,
          },
        });
        const currentWallet = await this.prisma.wallet.findUniqueOrThrow({
          where: { id: wallet.id },
          select: { balance: true },
        });
        return {
          result: ScanResult.ALREADY_SERVED,
          message: 'Cet étudiant a déjà été servi pour ce repas aujourd’hui.',
          balance: currentWallet.balance,
          currency: CURRENCY,
        };
      }

      throw error;
    }
  }

  async getTransactions(userId: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: { wallet: { userId } },
      orderBy: { createdAt: 'desc' },
    });

    return transactions.map((transaction) => ({
      ...transaction,
      currency: CURRENCY,
    }));
  }

  async topUp(userId: string, dto: TopUpDto) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    const status = dto.simulateFailure
      ? TransactionStatus.FAILED
      : TransactionStatus.SUCCESS;

    const result = await this.prisma.$transaction(async (transactionClient) => {
      if (status === TransactionStatus.SUCCESS) {
        await transactionClient.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: dto.amount } },
        });
      }

      const transaction = await transactionClient.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.CREDIT,
          status,
          amount: dto.amount,
        },
      });
      const updatedWallet = await transactionClient.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
        select: { balance: true },
      });

      return { transaction, balance: updatedWallet.balance };
    });

    return { ...result, currency: CURRENCY };
  }

  async purchase(userId: string, dto: PurchaseTicketDto) {
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: { id: true },
    });
    const pricePerTicket = MEAL_PRICES_XOF[dto.service];
    const amount = pricePerTicket * dto.quantity;
    if (!Number.isSafeInteger(amount) || amount > 2147483647) {
      throw new BadRequestException('Purchase amount exceeds supported range');
    }
    const status = dto.simulateFailure
      ? TransactionStatus.FAILED
      : TransactionStatus.SUCCESS;

    const result = await this.prisma.$transaction(async (transactionClient) => {
      if (status === TransactionStatus.SUCCESS) {
        const debit = await transactionClient.wallet.updateMany({
          where: { id: wallet.id, balance: { gte: amount } },
          data: { balance: { decrement: amount } },
        });

        if (debit.count === 0) {
          throw new BadRequestException('Insufficient wallet balance');
        }
      }

      const transaction = await transactionClient.transaction.create({
        data: {
          walletId: wallet.id,
          type: TransactionType.DEBIT,
          status,
          amount,
        },
      });
      const tickets =
        status === TransactionStatus.SUCCESS
          ? await transactionClient.ticket.createManyAndReturn({
              data: Array.from({ length: dto.quantity }, () => ({
                studentId: userId,
                service: dto.service,
              })),
            })
          : [];
      const updatedWallet = await transactionClient.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
        select: { balance: true },
      });

      return { transaction, tickets, balance: updatedWallet.balance };
    });

    return { ...result, pricePerTicket, currency: CURRENCY };
  }
}
