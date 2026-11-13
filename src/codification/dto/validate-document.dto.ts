import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DocStatus } from '@prisma/client';

export class ValidateDocumentDto {
  @ApiProperty({
    enum: DocStatus,
    example: DocStatus.APPROVED,
    description: 'Nouveau statut du document (APPROVED ou REJECTED)',
  })
  @IsEnum(DocStatus, { message: 'Statut invalide. Statuts acceptés: PENDING, APPROVED, REJECTED' })
  status!: DocStatus;

  @ApiPropertyOptional({
    example: 'Copie de la CNI illisible ou périmée',
    description: 'Motif de rejet obligatoire si le statut est REJECTED',
  })
  @ValidateIf((o) => o.status === DocStatus.REJECTED)
  @IsNotEmpty({ message: 'Un motif de rejet est obligatoire en cas de refus d un document' })
  @IsString()
  @IsOptional()
  rejectionReason?: string;
}