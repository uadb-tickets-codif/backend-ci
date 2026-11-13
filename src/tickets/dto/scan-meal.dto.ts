import { MealService } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString, MinLength } from 'class-validator';

export class ScanMealDto {
  @ApiProperty({
    description: 'Jeton signé contenu dans le QR code de l’étudiant.',
  })
  @IsString()
  @MinLength(1)
  qrToken!: string;

  @ApiProperty({ enum: MealService })
  @IsEnum(MealService)
  service!: MealService;
}
