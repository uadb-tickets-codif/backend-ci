import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class TopUpDto {
  @ApiProperty({ example: 1000, minimum: 1, maximum: 2147483647 })
  @IsInt()
  @Min(1)
  @Max(2147483647)
  amount!: number;

  @ApiPropertyOptional({
    description: 'Force un échec du paiement simulé, sans créditer le solde.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
