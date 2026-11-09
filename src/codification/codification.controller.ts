import {
  Controller,
  Post,
  Body,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody } from '@nestjs/swagger';
import { CodificationService } from './codification.service';
import { VerifyStudentDto } from './dto/verify-student.dto';

interface UploadedMulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags('codification')
@Controller('codification')
export class CodificationController {
  constructor(private readonly codificationService: CodificationService) {}

  @Post('import')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: UploadedMulterFile) {
    if (!file) {
      throw new BadRequestException('Veuillez joindre un fichier CSV');
    }
    return this.codificationService.importCodifiableStudents(file.buffer);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verifyEligibility(@Body() verifyStudentDto: VerifyStudentDto) {
    return this.codificationService.verifyStudentEligibility(verifyStudentDto);
  }
}