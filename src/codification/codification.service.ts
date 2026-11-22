import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  AssignmentStatus,
  BedStatus,
  CodificationStatus,
  DocStatus,
  Prisma,
  Role,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuthenticatedUser } from '../auth/auth.constants';
import { PrismaService } from '../prisma/prisma.service';
import { parseStudentsCsv } from './csv-import';
import { GetBedsFilterDto } from './dto/get-beds-filter.dto';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { VerifyStudentDto } from './dto/verify-student.dto';
import { detectFileType } from './file-type';

// Interface locale pour garantir la compatibilité Multer sans erreurs TypeScript
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const DOCUMENT_TYPES = ['CNI', 'STUDENT_CARD'] as const;
type DocumentType = (typeof DOCUMENT_TYPES)[number];

// Statuts dans lesquels l'étudiant peut (re)déposer ses pièces.
const UPLOAD_ALLOWED_STATUSES: CodificationStatus[] = [
  CodificationStatus.NOT_STARTED,
  CodificationStatus.DOCUMENTS_SUBMITTED,
  CodificationStatus.DOCUMENTS_REJECTED,
];

const LEGACY_MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

@Injectable()
export class CodificationService {
  // Répertoire privé hors du dossier public web (/uploads/documents)
  private readonly uploadBaseDir = path.join(process.cwd(), 'uploads', 'documents');

  constructor(private readonly prisma: PrismaService) {
    if (!fs.existsSync(this.uploadBaseDir)) {
      fs.mkdirSync(this.uploadBaseDir, { recursive: true });
    }
  }

  // ==========================================
  // IMPORT CSV ET VÉRIFICATION D'ÉLIGIBILITÉ
  // ==========================================

  async importCodifiableStudents(fileBuffer: Buffer) {
    const studentsToInsert = parseStudentsCsv(fileBuffer);

    try {
      const results = await this.prisma.$transaction(
        studentsToInsert.map((student) =>
          this.prisma.codifiableStudent.upsert({
            where: { studentNumber: student.studentNumber },
            update: student,
            create: student,
          }),
        ),
      );

      return {
        success: true,
        message: `${results.length} étudiants codifiables importés avec succès.`,
        importedCount: results.length,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Une adresse e-mail du fichier est déjà utilisée par un autre étudiant déjà importé. Aucun étudiant n’a été enregistré.',
        );
      }
      throw error;
    }
  }

  /**
   * Vérifie l'éligibilité de l'étudiant connecté. En cas de succès, le numéro
   * étudiant (et le genre de la liste officielle) est rattaché à son compte :
   * la date de naissance prouve qu'il s'agit bien de son matricule.
   */
  async verifyStudentEligibility(user: AuthenticatedUser, dto: VerifyStudentDto) {
    const studentNumber = dto.studentNumber.trim();

    if (user.studentNumber && user.studentNumber !== studentNumber) {
      throw new ForbiddenException(
        'Ce numéro étudiant ne correspond pas à celui rattaché à votre compte.',
      );
    }

    const student = await this.prisma.codifiableStudent.findUnique({
      where: { studentNumber },
    });

    // Même réponse dans les deux cas : on ne révèle pas quels matricules existent.
    if (
      !student ||
      student.birthDate.toISOString().slice(0, 10) !== dto.birthDate.slice(0, 10)
    ) {
      throw new NotFoundException(
        'Aucun étudiant codifiable ne correspond à ces informations. Vérifiez votre numéro étudiant et votre date de naissance.',
      );
    }

    if (!user.studentNumber) {
      try {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { studentNumber: student.studentNumber, gender: student.genre },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'Ce numéro étudiant est déjà rattaché à un autre compte.',
          );
        }
        throw error;
      }
    }

    return {
      eligible: true,
      message: 'Étudiant reconnu et éligible pour la codification.',
      student: {
        studentNumber: student.studentNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        level: student.level,
        genre: student.genre,
        email: student.email,
      },
    };
  }

  /** Situation de l'étudiant connecté : statut du dossier, pièces (avec motif de rejet) et lit. */
  async getMyCodification(user: AuthenticatedUser) {
    const [documents, assignment] = await Promise.all([
      this.prisma.document.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          type: true,
          fileName: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.assignment.findFirst({
        where: { userId: user.id, status: AssignmentStatus.ACTIVE },
        select: {
          id: true,
          createdAt: true,
          bed: {
            select: {
              label: true,
              room: {
                select: {
                  number: true,
                  floor: true,
                  pavilion: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      studentNumber: user.studentNumber,
      codificationStatus: user.codificationStatus,
      documents,
      assignment,
    };
  }

  // ==========================================
  // DOCUMENTS
  // ==========================================

  /**
   * Téléversement de la CNI et de la carte d'étudiant de l'étudiant connecté.
   * Le type réel des fichiers est lu dans leur contenu, pas dans leur nom.
   */
  async uploadStudentDocuments(
    user: AuthenticatedUser,
    files: { cni?: MulterFile[]; studentCard?: MulterFile[] },
  ) {
    if (!user.studentNumber) {
      throw new ForbiddenException(
        'Vérifiez d’abord votre éligibilité avec votre numéro étudiant et votre date de naissance.',
      );
    }

    const codifiable = await this.prisma.codifiableStudent.findUnique({
      where: { studentNumber: user.studentNumber },
      select: { id: true },
    });
    if (!codifiable) {
      throw new NotFoundException(
        `Aucun étudiant éligible trouvé avec le matricule '${user.studentNumber}'.`,
      );
    }

    if (!UPLOAD_ALLOWED_STATUSES.includes(user.codificationStatus)) {
      throw new ConflictException(
        'Votre dossier est déjà validé : vos pièces ne peuvent plus être modifiées.',
      );
    }

    const cniFile = files?.cni?.[0];
    const studentCardFile = files?.studentCard?.[0];
    if (!cniFile || !studentCardFile) {
      throw new BadRequestException('Les deux documents (CNI et carte étudiant) sont requis.');
    }

    const uploads = [
      { type: 'CNI' as DocumentType, label: 'La CNI', file: cniFile },
      { type: 'STUDENT_CARD' as DocumentType, label: 'La carte étudiant', file: studentCardFile },
    ].map(({ type, label, file }) => {
      const detected = detectFileType(file.buffer);
      if (!detected) {
        throw new BadRequestException(
          `${label} doit être un fichier PDF, JPG ou PNG valide.`,
        );
      }
      return { type, file, detected };
    });

    // Dossier isolé par compte : /uploads/documents/<id utilisateur>/
    const studentFolder = path.join(this.uploadBaseDir, user.id);
    await fs.promises.mkdir(studentFolder, { recursive: true });

    const written: string[] = [];
    try {
      const rows: Prisma.DocumentCreateManyInput[] = [];
      for (const { type, file, detected } of uploads) {
        const destination = path.join(
          studentFolder,
          `${type.toLowerCase()}_${uuidv4()}${detected.extension}`,
        );
        try {
          await fs.promises.writeFile(destination, file.buffer, { mode: 0o600 });
        } catch {
          throw new InternalServerErrorException(
            'Erreur lors de l’écriture du fichier sur le serveur.',
          );
        }
        written.push(destination);
        rows.push({
          userId: user.id,
          type,
          filePath: destination,
          fileName: this.sanitizeFileName(file.originalname, detected.extension),
          mimeType: detected.mimeType,
          status: DocStatus.PENDING,
        });
      }

      // Remplacement des anciennes pièces et mise à jour du statut, de façon atomique.
      const previousDocuments = await this.prisma.$transaction(async (tx) => {
        const previous = await tx.document.findMany({
          where: { userId: user.id, type: { in: [...DOCUMENT_TYPES] } },
          select: { id: true, filePath: true },
        });
        if (previous.length > 0) {
          await tx.document.deleteMany({
            where: { id: { in: previous.map((document) => document.id) } },
          });
        }
        await tx.document.createMany({ data: rows });
        await tx.user.update({
          where: { id: user.id },
          data: { codificationStatus: CodificationStatus.DOCUMENTS_SUBMITTED },
        });
        return previous;
      });

      await Promise.all(
        previousDocuments.map((document) => this.removeFileQuietly(document.filePath)),
      );
    } catch (error) {
      await Promise.all(written.map((filePath) => this.removeFileQuietly(filePath)));
      throw error;
    }

    return {
      success: true,
      message:
        'Vos pièces justificatives ont été téléversées avec succès. Votre dossier est en attente de validation.',
    };
  }

  /** Consultation de tous les documents par un administrateur (sans chemin serveur). */
  async getAllDocumentsForAdmin() {
    return this.prisma.document.findMany({
      omit: { filePath: true },
      include: {
        user: {
          select: {
            studentNumber: true,
            firstName: true,
            lastName: true,
            email: true,
            codificationStatus: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Validation ou rejet administratif d'un document. */
  async validateDocumentByAdmin(documentId: string, dto: ValidateDocumentDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { user: { select: { codificationStatus: true } } },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable');
    }

    if (document.user.codificationStatus === CodificationStatus.BED_SELECTED) {
      throw new ConflictException(
        'Le dossier est déjà finalisé : l’étudiant a réservé un lit.',
      );
    }

    const updatedDocument = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id: documentId },
        data: {
          status: dto.status,
          rejectionReason:
            dto.status === DocStatus.REJECTED ? dto.rejectionReason : null,
        },
        omit: { filePath: true },
      });

      // Mise à jour automatique du statut global de l'étudiant
      if (dto.status === DocStatus.REJECTED) {
        await tx.user.update({
          where: { id: document.userId },
          data: { codificationStatus: CodificationStatus.DOCUMENTS_REJECTED },
        });
      } else {
        const documents = await tx.document.findMany({
          where: { userId: document.userId },
          select: { status: true },
        });
        const allApproved =
          documents.length >= DOCUMENT_TYPES.length &&
          documents.every((item) => item.status === DocStatus.APPROVED);
        if (allApproved) {
          await tx.user.update({
            where: { id: document.userId },
            data: { codificationStatus: CodificationStatus.DOCUMENTS_APPROVED },
          });
        }
      }

      return updated;
    });

    return {
      success: true,
      message: `Document ${dto.status === DocStatus.APPROVED ? 'approuvé' : 'rejeté'} avec succès.`,
      document: updatedDocument,
    };
  }

  /**
   * Téléchargement sécurisé : seul le propriétaire du document ou un
   * administrateur y accède (l'identité vient du jeton, jamais de l'URL).
   */
  async getSecureDocumentStream(documentId: string, user: AuthenticatedUser) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        userId: true,
        filePath: true,
        fileName: true,
        mimeType: true,
      },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable');
    }

    if (user.role !== Role.ADMIN && document.userId !== user.id) {
      throw new ForbiddenException(
        'Accès refusé : seul le titulaire du document ou un administrateur peut accéder à ce fichier.',
      );
    }

    const absolutePath = path.resolve(document.filePath);
    const baseDir = path.resolve(this.uploadBaseDir);
    if (!absolutePath.startsWith(baseDir + path.sep)) {
      throw new NotFoundException('Le fichier physique est introuvable.');
    }

    try {
      await fs.promises.access(absolutePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(
        'Le fichier physique n’existe pas sur le volume de stockage.',
      );
    }

    const extension = path.extname(absolutePath).toLowerCase();
    return {
      stream: fs.createReadStream(absolutePath),
      mimeType:
        document.mimeType ??
        LEGACY_MIME_BY_EXTENSION[extension] ??
        'application/octet-stream',
      fileName: document.fileName ?? path.basename(absolutePath),
    };
  }

  // ==========================================
  // LITS ET RÉSERVATION
  // ==========================================

  async getFilteredBeds(filters: GetBedsFilterDto, user: AuthenticatedUser) {
    const { pavilion, floor, status } = filters;
    // Un étudiant ne voit que les pavillons de son genre.
    const gender = user.role === Role.STUDENT ? user.gender : filters.gender;

    return this.prisma.bed.findMany({
      where: {
        status: status ?? BedStatus.AVAILABLE,
        room: {
          ...(floor !== undefined ? { floor } : {}),
          pavilion: {
            ...(gender ? { gender } : {}),
            ...(pavilion
              ? {
                  OR: [
                    { id: pavilion },
                    { name: { contains: pavilion, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
        },
      },
      include: {
        room: {
          include: {
            pavilion: true,
          },
        },
      },
      orderBy: [
        { room: { pavilion: { name: 'asc' } } },
        { room: { floor: 'asc' } },
        { room: { number: 'asc' } },
        { label: 'asc' },
      ],
    });
  }

  async reserveBed(bedId: string, currentUser: AuthenticatedUser) {
    return this.prisma.$transaction(
      async (tx) => {
        // 1. Verrou sur la ligne de l'étudiant : deux requêtes simultanées du même
        //    étudiant ne peuvent pas réserver deux lits différents.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${currentUser.id} FOR UPDATE`;

        const user = await tx.user.findUnique({
          where: { id: currentUser.id },
          include: {
            assignments: {
              where: { status: AssignmentStatus.ACTIVE },
            },
          },
        });

        if (!user) {
          throw new NotFoundException('Compte étudiant introuvable.');
        }

        if (user.codificationStatus !== CodificationStatus.DOCUMENTS_APPROVED) {
          throw new ForbiddenException(
            `Dossier non éligible à la réservation (statut actuel : ${user.codificationStatus}). Vos documents doivent être approuvés.`,
          );
        }

        // 2. Règle métier : un seul lit actif par étudiant
        if (user.assignments.length > 0) {
          throw new ConflictException(
            'Vous avez déjà réservé un lit actif. Un seul lit est autorisé par étudiant.',
          );
        }

        // 3. Verrouillage pessimiste SQL (FOR UPDATE) sur la ligne du lit ciblé
        const lockedBeds = await tx.$queryRaw<
          Array<{ id: string; status: string; room_id: string }>
        >`
          SELECT id, status, room_id
          FROM beds
          WHERE id = ${bedId}
          FOR UPDATE
        `;

        if (!lockedBeds || lockedBeds.length === 0) {
          throw new NotFoundException(`Lit avec l'ID ${bedId} introuvable.`);
        }

        const lockedBed = lockedBeds[0];

        if (lockedBed.status !== BedStatus.AVAILABLE) {
          throw new ConflictException(
            `Ce lit n'est plus disponible (statut actuel : ${lockedBed.status}).`,
          );
        }

        // 4. Vérifier la correspondance de genre entre l'étudiant et le pavillon
        const room = await tx.room.findUnique({
          where: { id: lockedBed.room_id },
          include: { pavilion: true },
        });

        if (!room) {
          throw new NotFoundException('Chambre associée introuvable.');
        }

        if (room.pavilion.gender !== user.gender) {
          throw new ForbiddenException(
            `Ce pavillon (${room.pavilion.name}) est réservé au genre ${room.pavilion.gender}.`,
          );
        }

        // 5. Attribution atomique : affectation + lit + statut de l'étudiant
        const assignment = await tx.assignment.create({
          data: {
            userId: user.id,
            bedId: lockedBed.id,
            status: AssignmentStatus.ACTIVE,
          },
          include: {
            bed: {
              include: {
                room: {
                  include: { pavilion: true },
                },
              },
            },
          },
        });

        await tx.bed.update({
          where: { id: lockedBed.id },
          data: { status: BedStatus.OCCUPIED },
        });

        await tx.user.update({
          where: { id: user.id },
          data: { codificationStatus: CodificationStatus.BED_SELECTED },
        });

        return {
          success: true,
          message: 'Lit réservé avec succès.',
          assignment,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
      },
    );
  }

  // ==========================================
  // UTILITAIRES
  // ==========================================

  /** Nom d'origine nettoyé (sans chemin ni caractères de contrôle), extension du vrai type. */
  private sanitizeFileName(originalName: string, extension: string): string {
    const base = path
      .basename(originalName || 'document', path.extname(originalName || ''))
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f"\\/:*?<>|]/g, '_')
      .trim()
      .slice(0, 80);
    return `${base || 'document'}${extension}`;
  }

  private async removeFileQuietly(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    const baseDir = path.resolve(this.uploadBaseDir);
    if (!absolutePath.startsWith(baseDir + path.sep)) {
      return;
    }
    try {
      await fs.promises.rm(absolutePath, { force: true });
    } catch {
      // Suppression au mieux : un fichier orphelin ne doit pas faire échouer la requête.
    }
  }
}
