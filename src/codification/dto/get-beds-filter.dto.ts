import { IsOptional, IsString, IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender, BedStatus } from '@prisma/client';

export class GetBedsFilterDto {
  @ApiPropertyOptional({ description: 'ID ou nom du pavillon (ex: Pavillon A)' })
  @IsOptional()
  @IsString()
  pavilion?: string;

  @ApiPropertyOptional({ description: 'Numéro d’étage (ex: 0, 1, 2)', type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floor?: number;

  @ApiPropertyOptional({ enum: Gender, description: 'Genre du pavillon (MALE ou FEMALE)' })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional({
    enum: BedStatus,
    default: BedStatus.AVAILABLE,
    description: 'Statut du lit (par défaut AVAILABLE)',
  })
  @IsOptional()
  @IsEnum(BedStatus)
  status?: BedStatus;
}