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
  Req,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiConsumes, ApiBody, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { CodificationService, MulterFile } from './codification.service';
import { VerifyStudentDto } from './dto/verify-student.dto';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { GetBedsFilterDto } from './dto/get-beds-filter.dto';
import { ReserveBedDto } from './dto/reserve-bed.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedUser } from '../auth/auth.constants';
import { Role } from '@prisma/client';
import { Request } from 'express';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

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
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('codification')
export class CodificationController {
  constructor(private readonly codificationService: CodificationService) {}

  // ==========================================
  // CARTE 11 : ENDPOINTS (BULK IMPORT & VERIFY)
  // ==========================================

  @Post('import')
  @Roles(Role.ADMIN)
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
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification d éligibilité étudiant (Carte 11)' })
  async verifyEligibility(@Req() request: AuthenticatedRequest, @Body() verifyStudentDto: VerifyStudentDto) {
    if (verifyStudentDto.studentNumber.trim() !== request.user.studentNumber) {
      throw new ForbiddenException('Vous ne pouvez vérifier que votre propre dossier étudiant.');
    }
    return this.codificationService.verifyStudentEligibility(verifyStudentDto);
  }

  // ==========================================
  // CARTE 12 : ENDPOINTS (DOCUMENTS & ADMIN)
  // ==========================================

  @Post('upload-documents')
  @Roles(Role.STUDENT)
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
    @Req() request: AuthenticatedRequest,
    @Body() dto: UploadDocumentsDto,
    @UploadedFiles()
    files: { cni?: MulterFile[]; studentCard?: MulterFile[] },
  ) {
    if (dto.studentNumber.trim() !== request.user.studentNumber) {
      throw new ForbiddenException('Vous ne pouvez déposer que vos propres documents.');
    }
    return this.codificationService.uploadStudentDocuments(dto, files);
  }

  @Get('admin/documents')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Consultation de tous les documents par l Admin (Carte 12)' })
  async getAllDocuments() {
    return this.codificationService.getAllDocumentsForAdmin();
  }

  @Patch('admin/documents/:id/validate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Validation ou rejet d un document par l Admin (Carte 12)' })
  async validateDocument(
    @Param('id') id: string,
    @Body() dto: ValidateDocumentDto,
  ) {
    return this.codificationService.validateDocumentByAdmin(id, dto);
  }

  @Get('documents/:id/download')
  @Roles(Role.STUDENT, Role.ADMIN)
  @ApiOperation({ summary: 'Téléchargement sécurisé d un document (Carte 12)' })
  async downloadDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const isUserAdmin = request.user.role === Role.ADMIN;
    const { stream, mimeType, fileName } =
      await this.codificationService.getSecureDocumentStream(id, request.user.studentNumber ?? undefined, isUserAdmin);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    stream.pipe(res);
  }

  // ==========================================
  // CARTE 13 : ENDPOINTS (LITS & RÉSERVATION)
  // ==========================================

  @Get('beds')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Liste des lits avec filtres pavillon, étage, genre (Carte 13)' })
  async getBeds(@Query() filters: GetBedsFilterDto) {
    return this.codificationService.getFilteredBeds(filters);
  }

  @Post('beds/:id/reserve')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réservation atomique d’un lit avec verrouillage transactionnel (Carte 13)' })
  @ApiParam({ name: 'id', description: 'UUID du lit à réserver' })
  async reserveBed(
    @Req() request: AuthenticatedRequest,
    @Param('id') bedId: string,
    @Body() dto: ReserveBedDto,
  ) {
    if (dto.studentNumber.trim() !== request.user.studentNumber) {
      throw new ForbiddenException('Vous ne pouvez réserver un lit que pour votre propre compte.');
    }
    return this.codificationService.reserveBed(bedId, dto.studentNumber);
  }
}
