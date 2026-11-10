import { Module } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  controllers: [TicketsController],
  providers: [TicketsService, JwtAuthGuard],
})
export class TicketsModule {}
