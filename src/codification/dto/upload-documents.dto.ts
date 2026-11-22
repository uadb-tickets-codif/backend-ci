import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UploadDocumentsDto {
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Ignoré : l’étudiant est identifié par son jeton d’accès et le numéro rattaché à son compte.',
  })
  @IsOptional()
  @IsString()
  studentNumber?: string;
}
