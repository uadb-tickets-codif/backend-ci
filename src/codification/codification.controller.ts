import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  HttpCode,
  HttpStatus,
  Res,
  Query,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiQuery, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { CodificationService, MulterFile } from './codification.service';
import { VerifyStudentDto } from './dto/verify-student.dto';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { ValidateDocumentDto } from './dto/validate-document.dto';

// Filtre de sécurité : MIME types autorisés (PDF, JPG, PNG)
const documentFileFilter = (req: any, file: MulterFile, callback: any) => {
  const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
  if (!allowedMimeTypes.includes(file.mimetype)) {
    return callback(
      new BadRequestException(
        `Format de fichier non autorisé (${file.mimetype}). Seuls PDF, JPG et PNG sont acceptés.`,
      ),
      false,
    );
  }
  callback(null, true);
};

@ApiTags('codification')
@Controller('codification')
export class CodificationController {
  constructor(private readonly codificationService: CodificationService) {}

  // ==========================================
  // CARTE 11 : ENDPOINTS (BULK IMPORT & VERIFY)
  // ==========================================

  @Post('import')
  @ApiOperation({ summary: 'Importation bulk CSV des étudiants (Carte 11)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  async importCsv(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException('Veuillez joindre un fichier CSV');
    }
    return this.codificationService.importCodifiableStudents(file.buffer);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification d éligibilité étudiant (Carte 11)' })
  async verifyEligibility(@Body() verifyStudentDto: VerifyStudentDto) {
    return this.codificationService.verifyStudentEligibility(verifyStudentDto);
  }

  // ==========================================
  // CARTE 12 : ENDPOINTS (DOCUMENTS & ADMIN)
  // ==========================================

  @Post('upload-documents')
  @ApiOperation({ summary: 'Téléversement sécurisé CNI et carte étudiant (Carte 12)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['studentNumber', 'cni', 'studentCard'],
      properties: {
        studentNumber: {
          type: 'string',
          example: '20260001',
          description: 'Matricule de l étudiant',
        },
        cni: {
          type: 'string',
          format: 'binary',
          description: 'Fichier CNI (PDF, JPG, PNG - max 5Mo)',
        },
        studentCard: {
          type: 'string',
          format: 'binary',
          description: 'Fichier Carte d étudiant (PDF, JPG, PNG - max 5Mo)',
        },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'cni', maxCount: 1 },
        { name: 'studentCard', maxCount: 1 },
      ],
      {
        limits: { fileSize: 5 * 1024 * 1024 }, // Limite stricte de 5 Mo par fichier
        fileFilter: documentFileFilter,
      },
    ),
  )
  async uploadDocuments(
    @Body() dto: UploadDocumentsDto,
    @UploadedFiles()
    files: { cni?: MulterFile[]; studentCard?: MulterFile[] },
  ) {
    return this.codificationService.uploadStudentDocuments(dto, files);
  }

  @Get('admin/documents')
  @ApiOperation({ summary: 'Consultation de tous les documents par l Admin (Carte 12)' })
  async getAllDocuments() {
    return this.codificationService.getAllDocumentsForAdmin();
  }

  @Patch('admin/documents/:id/validate')
  @ApiOperation({ summary: 'Validation ou rejet d un document par l Admin (Carte 12)' })
  async validateDocument(
    @Param('id') id: string,
    @Body() dto: ValidateDocumentDto,
  ) {
    return this.codificationService.validateDocumentByAdmin(id, dto);
  }

  @Get('documents/:id/download')
  @ApiOperation({ summary: 'Téléchargement sécurisé d un document (Carte 12)' })
  @ApiQuery({ name: 'studentNumber', required: false, description: 'Matricule pour vérification étudiant' })
  @ApiQuery({ name: 'isAdmin', required: false, type: Boolean, description: 'Passer à true si requête Admin' })
  async downloadDocument(
    @Param('id') id: string,
    @Query('studentNumber') studentNumber: string,
    @Query('isAdmin') isAdmin: string,
    @Res() res: Response,
  ) {
    const isUserAdmin = isAdmin === 'true';
    const { stream, mimeType, fileName } =
      await this.codificationService.getSecureDocumentStream(id, studentNumber, isUserAdmin);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    stream.pipe(res);
  }
}