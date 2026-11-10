import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/auth.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { PurchaseTicketDto } from './dto/purchase-ticket.dto';
import { ScanMealDto } from './dto/scan-meal.dto';
import { TopUpDto } from './dto/top-up.dto';
import { TicketsService } from './tickets.service';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@ApiTags('wallet and tickets')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Jeton absent ou invalide' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get('wallet')
  @ApiOkResponse({ description: 'Solde du portefeuille en FCFA' })
  getWallet(@Req() request: AuthenticatedRequest) {
    return this.ticketsService.getWallet(request.user.id);
  }

  @Post('wallet/top-up')
  @ApiCreatedResponse({ description: 'Résultat de la recharge simulée' })
  topUp(@Req() request: AuthenticatedRequest, @Body() dto: TopUpDto) {
    return this.ticketsService.topUp(request.user.id, dto);
  }

  @Get('wallet/transactions')
  @ApiOkResponse({ description: 'Historique des transactions du portefeuille' })
  getTransactions(@Req() request: AuthenticatedRequest) {
    return this.ticketsService.getTransactions(request.user.id);
  }

  @Get('tickets/prices')
  @ApiOkResponse({
    description: 'Tarifs des tickets par type de repas en FCFA',
  })
  getPrices() {
    return this.ticketsService.getPrices();
  }

  @Post('tickets/qr-token')
  @Roles(Role.STUDENT)
  @ApiCreatedResponse({
    description: 'Jeton signé et temporaire à encoder dans le QR étudiant',
  })
  createQrToken(@Req() request: AuthenticatedRequest) {
    return this.ticketsService.createQrToken(request.user.id);
  }

  @Post('tickets/scan')
  @Roles(Role.CONTROLLER, Role.ADMIN)
  @ApiCreatedResponse({
    description:
      'Résultat du scan : accepté, solde insuffisant, déjà servi ou jeton invalide',
  })
  scan(
    @Req() request: AuthenticatedRequest,
    @Body() dto: ScanMealDto,
  ) {
    return this.ticketsService.scan(request.user.id, dto);
  }

  @Post('tickets/purchase')
  @ApiCreatedResponse({ description: 'Résultat de l’achat simulé' })
  purchase(
    @Req() request: AuthenticatedRequest,
    @Body() dto: PurchaseTicketDto,
  ) {
    return this.ticketsService.purchase(request.user.id, dto);
  }
}
