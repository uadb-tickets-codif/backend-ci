import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadDocumentsDto {
  @ApiProperty({
    example: '20260001',
    description: 'Numéro de matricule de l étudiant effectuant le téléversement',
  })
  @IsNotEmpty({ message: 'Le numéro de matricule est obligatoire' })
  @IsString()
  studentNumber!: string;
}