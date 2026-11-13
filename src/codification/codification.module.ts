import { Module } from '@nestjs/common';
import { CodificationController } from './codification.controller';
import { CodificationService } from './codification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CodificationController],
  providers: [CodificationService],
  exports: [CodificationService],
})
export class CodificationModule {}