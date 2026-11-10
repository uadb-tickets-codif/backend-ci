import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionStatus, TransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseTicketDto } from './dto/purchase-ticket.dto';
import { TopUpDto } from './dto/top-up.dto';
import { MEAL_PRICES_XOF } from './tickets.constants';

const CURRENCY = 'XOF';

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

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
