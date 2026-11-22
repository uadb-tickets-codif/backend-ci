import { IsIn, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocStatus } from '@prisma/client';

export class ValidateDocumentDto {
  @ApiProperty({
    enum: [DocStatus.APPROVED, DocStatus.REJECTED],
    example: DocStatus.APPROVED,
    description: 'Décision de l’administrateur (APPROVED ou REJECTED)',
  })
  @IsIn([DocStatus.APPROVED, DocStatus.REJECTED], {
    message: 'Statut invalide. Statuts acceptés : APPROVED, REJECTED',
  })
  status!: DocStatus;

  @ApiPropertyOptional({
    example: 'Copie de la CNI illisible ou périmée',
    description: 'Motif de rejet, obligatoire si le statut est REJECTED',
  })
  @ValidateIf((o: ValidateDocumentDto) => o.status === DocStatus.REJECTED)
  @IsNotEmpty({ message: 'Un motif de rejet est obligatoire en cas de refus d’un document' })
  @IsString()
  @MaxLength(500)
  rejectionReason?: string;
}
