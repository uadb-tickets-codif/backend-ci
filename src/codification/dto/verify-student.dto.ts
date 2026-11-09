import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyStudentDto {
  @ApiProperty({ example: '20260001', description: 'Numéro de matricule étudiant' })
  @IsNotEmpty({ message: 'Le numéro étudiant est obligatoire' })
  @IsString()
  studentNumber!: string;

  @ApiProperty({ example: '2002-05-15', description: 'Date de naissance (YYYY-MM-DD)' })
  @IsNotEmpty({ message: 'La date de naissance est obligatoire' })
  @IsString()
  birthDate!: string;
}