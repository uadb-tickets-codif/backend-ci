import { MealService } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

export class PurchaseTicketDto {
  @ApiProperty({ enum: MealService })
  @IsEnum(MealService)
  service!: MealService;

  @ApiProperty({ example: 1, minimum: 1, default: 1 })
  @IsInt()
  @Min(1)
  quantity = 1;

  @ApiPropertyOptional({
    description: 'Force un échec du paiement simulé, sans débiter le solde.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
