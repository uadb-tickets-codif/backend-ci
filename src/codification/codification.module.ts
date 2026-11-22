import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CodificationController } from './codification.controller';
import { CodificationService } from './codification.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CodificationController],
  providers: [CodificationService],
  exports: [CodificationService],
})
export class CodificationModule {}
