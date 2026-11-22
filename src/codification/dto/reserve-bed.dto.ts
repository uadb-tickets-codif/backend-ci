import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReserveBedDto {
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignoré : le lit est réservé pour l’étudiant identifié par son jeton d’accès.',
  })
  @IsOptional()
  @IsString()
  studentNumber?: string;
}
