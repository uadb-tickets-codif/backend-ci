import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReserveBedDto {
  @ApiProperty({
    example: '20260003',
    description: 'Matricule de l’étudiant qui réserve le lit',
  })
  @IsString()
  @IsNotEmpty({ message: 'Le matricule étudiant est obligatoire.' })
  studentNumber: string;
}