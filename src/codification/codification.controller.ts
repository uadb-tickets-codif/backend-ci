import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor, FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../auth/auth.constants';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { CodificationService, MulterFile } from './codification.service';
import { GetBedsFilterDto } from './dto/get-beds-filter.dto';
import { ReserveBedDto } from './dto/reserve-bed.dto';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { VerifyStudentDto } from './dto/verify-student.dto';

type AuthenticatedRequest = Request & { user: AuthenticatedUser };

const ALLOWED_DOCUMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];

// Premier filtre sur le type déclaré ; le contenu réel est vérifié par le service.
const documentFileFilter = (
  _req: unknown,
  file: MulterFile,
  callback: (error: Error | null, acceptFile: boolean) => void,
) => {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.includes(file.mimetype)) {
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
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Jeton absent ou invalide' })
@ApiForbiddenResponse({ description: 'Rôle insuffisant' })
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('codification')
export class CodificationController {
  constructor(private readonly codificationService: CodificationService) {}

  // ==========================================
  // IMPORT CSV ET VÉRIFICATION
  // ==========================================

  @Post('import')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Importation en masse (CSV) des étudiants codifiables — administrateur' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async importCsv(@UploadedFile() file: MulterFile) {
    if (!file) {
      throw new BadRequestException('Veuillez joindre un fichier CSV');
    }
    return this.codificationService.importCodifiableStudents(file.buffer);
  }

  @Post('verify')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 20, windowMs: 15 * 60 * 1000 })
  @ApiOperation({
    summary:
      'Vérification d’éligibilité de l’étudiant connecté ; rattache son numéro étudiant au compte',
  })
  async verifyEligibility(
    @Req() request: AuthenticatedRequest,
    @Body() verifyStudentDto: VerifyStudentDto,
  ) {
    return this.codificationService.verifyStudentEligibility(
      request.user,
      verifyStudentDto,
    );
  }

  // ==========================================
  // DOCUMENTS
  // ==========================================

  @Get('me')
  @Roles(Role.STUDENT)
  @ApiOperation({
    summary:
      'Situation de l’étudiant connecté : statut du dossier, documents (motif de rejet) et lit réservé',
  })
  async getMyCodification(@Req() request: AuthenticatedRequest) {
    return this.codificationService.getMyCodification(request.user);
  }

  @Post('upload-documents')
  @Roles(Role.STUDENT)
  @ApiOperation({ summary: 'Téléversement sécurisé de la CNI et de la carte étudiant' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['cni', 'studentCard'],
      properties: {
        cni: {
          type: 'string',
          format: 'binary',
          description: 'Fichier CNI (PDF, JPG, PNG - max 5Mo)',
        },
        studentCard: {
          type: 'string',
          format: 'binary',
          description: 'Fichier carte d’étudiant (PDF, JPG, PNG - max 5Mo)',
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
    // Le corps n'est plus utilisé pour identifier l'étudiant (voir DTO).
    @Body() _dto: UploadDocumentsDto,
    @UploadedFiles()
    files: { cni?: MulterFile[]; studentCard?: MulterFile[] },
  ) {
    return this.codificationService.uploadStudentDocuments(request.user, files);
  }

  @Get('admin/documents')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Consultation de tous les documents — administrateur' })
  async getAllDocuments() {
    return this.codificationService.getAllDocumentsForAdmin();
  }

  @Patch('admin/documents/:id/validate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Validation ou rejet d’un document — administrateur' })
  async validateDocument(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ValidateDocumentDto,
  ) {
    return this.codificationService.validateDocumentByAdmin(id, dto);
  }

  @Get('documents/:id/download')
  @Roles(Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary: 'Téléchargement d’un document (son titulaire ou un administrateur)',
  })
  async downloadDocument(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ) {
    const { stream, mimeType, fileName } =
      await this.codificationService.getSecureDocumentStream(id, request.user);

    res.setHeader('Content-Type', mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.end();
    });
    stream.pipe(res);
  }

  // ==========================================
  // LITS ET RÉSERVATION
  // ==========================================

  @Get('beds')
  @Roles(Role.STUDENT, Role.ADMIN)
  @ApiOperation({
    summary:
      'Liste des lits (filtres pavillon, étage, statut) ; un étudiant ne voit que les pavillons de son genre',
  })
  async getBeds(
    @Req() request: AuthenticatedRequest,
    @Query() filters: GetBedsFilterDto,
  ) {
    return this.codificationService.getFilteredBeds(filters, request.user);
  }

  @Post('beds/:id/reserve')
  @Roles(Role.STUDENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Réservation atomique d’un lit pour l’étudiant connecté (verrouillage transactionnel)',
  })
  @ApiParam({ name: 'id', description: 'UUID du lit à réserver' })
  // Aucun corps n'est nécessaire : l'étudiant est identifié par son jeton.
  @ApiBody({ type: ReserveBedDto, required: false })
  async reserveBed(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) bedId: string,
  ) {
    return this.codificationService.reserveBed(bedId, request.user);
  }
}
