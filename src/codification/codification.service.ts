import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Papa from 'papaparse';
import {
  Prisma,
  Gender,
  DocStatus,
  CodificationStatus,
  BedStatus,
  AssignmentStatus,
} from '@prisma/client';
import { VerifyStudentDto } from './dto/verify-student.dto';
import { UploadDocumentsDto } from './dto/upload-documents.dto';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { GetBedsFilterDto } from './dto/get-beds-filter.dto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Interface locale pour garantir la compatibilité Multer sans erreurs TypeScript
export interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

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
  // CARTE 11 : METHODES EXISTANTES (BULK & VERIFY)
  // ==========================================

  async importCodifiableStudents(fileBuffer: Buffer) {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Le fichier CSV transmis est vide');
    }

    const csvString = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');

    const parseResult = Papa.parse<Record<string, string>>(csvString, {
      header: true,
      skipEmptyLines: true,
      delimitersToGuess: [',', ';', '\t'],
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      if (!parseResult.data || parseResult.data.length === 0) {
        throw new BadRequestException(
          `Erreur de lecture du fichier CSV: ${parseResult.errors[0].message}`,
        );
      }
    }

    const rows = parseResult.data;

    if (!rows || rows.length === 0) {
      throw new BadRequestException('Le fichier CSV ne contient aucune donnée');
    }

    const normalizeKey = (key: string) => key.trim().toLowerCase().replace(/[\s_]+/g, '');

    const expectedNormalizedFields = [
      'studentnumber',
      'lastname',
      'firstname',
      'birthdate',
      'genre',
      'level',
      'email',
    ];

    const sampleRowKeys = Object.keys(rows[0]).map(normalizeKey);
    const hasRequiredFields = expectedNormalizedFields.every((field) =>
      sampleRowKeys.includes(field),
    );

    if (!hasRequiredFields) {
      throw new BadRequestException(
        'Format de colonnes invalide. Colonnes attendues: student_number, last_name, first_name, birth_date, genre, level, email',
      );
    }

    const studentsToInsert = [];
    for (let i = 0; i < rows.length; i++) {
      const rawRow = rows[i];
      const normalizedRow: Record<string, string> = {};
      Object.keys(rawRow).forEach((key) => {
        normalizedRow[normalizeKey(key)] = rawRow[key];
      });

      const studentNumber = normalizedRow['studentnumber'];
      const lastName = normalizedRow['lastname'];
      const firstName = normalizedRow['firstname'];
      const birthDateRaw = normalizedRow['birthdate'];
      const genreRaw = normalizedRow['genre'] || normalizedRow['gender'];
      const level = normalizedRow['level'];
      const email = normalizedRow['email'];

      if (!studentNumber || !lastName || !firstName || !birthDateRaw || !email) {
        throw new BadRequestException(`Ligne ${i + 2}: Champs obligatoires manquants`);
      }

      const birthDate = new Date(birthDateRaw);
      if (isNaN(birthDate.getTime())) {
        throw new BadRequestException(
          `Ligne ${i + 2}: Date de naissance invalide (${birthDateRaw})`,
        );
      }

      const genre =
        (genreRaw || 'MALE').toUpperCase() === 'FEMALE' ? Gender.FEMALE : Gender.MALE;

      studentsToInsert.push({
        studentNumber: String(studentNumber).trim(),
        lastName: String(lastName).trim(),
        firstName: String(firstName).trim(),
        birthDate,
        genre,
        level: String(level).trim(),
        email: String(email).trim().toLowerCase(),
      });
    }

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
  }

  async verifyStudentEligibility(dto: VerifyStudentDto) {
    const student = await this.prisma.codifiableStudent.findUnique({
      where: { studentNumber: dto.studentNumber.trim() },
    });

    if (!student) {
      throw new NotFoundException(
        `Aucun étudiant codifiable trouvé avec le matricule '${dto.studentNumber}'. Vous n'êtes pas éligible à la codification.`,
      );
    }

    const inputDate = new Date(dto.birthDate).toISOString().split('T')[0];
    const dbDate = new Date(student.birthDate).toISOString().split('T')[0];

    if (inputDate !== dbDate) {
      throw new BadRequestException(
        'Les informations saisies ne correspondent pas aux données enregistrées (Date de naissance incorrecte).',
      );
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

  // ==========================================
  // CARTE 12 : TELEVERSEMENT SECURISE ET ADMIN
  // ==========================================

  /**
   * Téléversement sécurisé de la CNI et de la Carte d'étudiant
   */
  async uploadStudentDocuments(
    dto: UploadDocumentsDto,
    files: { cni?: MulterFile[]; studentCard?: MulterFile[] },
  ) {
    const studentNumber = dto.studentNumber.trim();

    // 1. Recherche de l'étudiant éligible
    const codifiable = await this.prisma.codifiableStudent.findUnique({
      where: { studentNumber },
    });

    if (!codifiable) {
      throw new NotFoundException(
        `Aucun étudiant éligible trouvé avec le matricule '${studentNumber}'.`,
      );
    }

    // Recherche ou création automatique du compte utilisateur
    let user = await this.prisma.user.findUnique({
      where: { studentNumber },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          studentNumber: codifiable.studentNumber,
          firstName: codifiable.firstName,
          lastName: codifiable.lastName,
          email: codifiable.email,
          gender: codifiable.genre,
          passwordHash: '$2b$10$e8R6.Q4nQ2W21/bM8QeJ8uW2211223344556677889900', // Hash temporaire
          codificationStatus: CodificationStatus.DOCUMENTS_SUBMITTED,
        },
      });
    }

    const cniFile = files?.cni?.[0];
    const studentCardFile = files?.studentCard?.[0];

    if (!cniFile || !studentCardFile) {
      throw new BadRequestException('Les deux documents (CNI et carte étudiant) sont requis.');
    }

    // 2. Création du dossier isolé : /uploads/documents/<studentNumber>/
    const studentFolder = path.join(this.uploadBaseDir, studentNumber);
    if (!fs.existsSync(studentFolder)) {
      fs.mkdirSync(studentFolder, { recursive: true });
    }

    const saveSecureDocument = async (file: MulterFile, docTypeLabel: string) => {
      const fileExt = path.extname(file.originalname).toLowerCase();
      const safeFileName = `${docTypeLabel.toLowerCase()}_${uuidv4()}${fileExt}`;
      const destinationPath = path.join(studentFolder, safeFileName);

      try {
        fs.writeFileSync(destinationPath, file.buffer);
      } catch (error) {
        throw new InternalServerErrorException('Erreur lors de l écriture du fichier sur le serveur.');
      }

      // Remplacement si un document existait déjà
      const existingDoc = await this.prisma.document.findFirst({
        where: { userId: user!.id, type: docTypeLabel },
      });

      if (existingDoc && fs.existsSync(existingDoc.filePath)) {
        try {
          fs.unlinkSync(existingDoc.filePath);
        } catch (_) {}
        await this.prisma.document.delete({ where: { id: existingDoc.id } });
      }

      return this.prisma.document.create({
        data: {
          userId: user!.id,
          type: docTypeLabel,
          filePath: destinationPath,
          status: DocStatus.PENDING,
        },
      });
    };

    await saveSecureDocument(cniFile, 'CNI');
    await saveSecureDocument(studentCardFile, 'STUDENT_CARD');

    // Mise à jour du statut global de codification
    await this.prisma.user.update({
      where: { id: user.id },
      data: { codificationStatus: CodificationStatus.DOCUMENTS_SUBMITTED },
    });

    return {
      success: true,
      message: 'Vos pièces justificatives ont été téléversées avec succès. Votre dossier est en attente de validation.',
    };
  }

  /**
   * Consultation de tous les documents par un Administrateur
   */
  async getAllDocumentsForAdmin() {
    return this.prisma.document.findMany({
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

  /**
   * Validation ou Rejet administratif d'un document
   */
  async validateDocumentByAdmin(documentId: string, dto: ValidateDocumentDto) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { user: true },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable');
    }

    const updatedDocument = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: dto.status,
        rejectionReason: dto.status === DocStatus.REJECTED ? dto.rejectionReason : null,
      },
    });

    // Mise à jour automatique du statut global de l'étudiant
    if (dto.status === DocStatus.REJECTED) {
      await this.prisma.user.update({
        where: { id: document.userId },
        data: { codificationStatus: CodificationStatus.DOCUMENTS_REJECTED },
      });
    } else if (dto.status === DocStatus.APPROVED) {
      const pendingOrRejectedDocs = await this.prisma.document.count({
        where: {
          userId: document.userId,
          status: { in: [DocStatus.PENDING, DocStatus.REJECTED] },
        },
      });

      if (pendingOrRejectedDocs === 0) {
        await this.prisma.user.update({
          where: { id: document.userId },
          data: { codificationStatus: CodificationStatus.DOCUMENTS_APPROVED },
        });
      }
    }

    return {
      success: true,
      message: `Document ${dto.status === DocStatus.APPROVED ? 'approuvé' : 'rejeté'} avec succès.`,
      document: updatedDocument,
    };
  }

  /**
   * Téléchargement / Visionnage sécurisé du document (Contrôle d'accès strict)
   */
  async getSecureDocumentStream(
    documentId: string,
    requestingStudentNumber?: string,
    isAdmin = false,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      include: { user: true },
    });

    if (!document) {
      throw new NotFoundException('Document introuvable');
    }

    // OWASP - Access Control : Vérification strict du propriétaire ou admin
    const ownerStudentNumber = document.user.studentNumber;
    if (!isAdmin && requestingStudentNumber !== ownerStudentNumber) {
      throw new ForbiddenException(
        'Accès refusé : Seul le titulaire du document ou un administrateur peut accéder à ce fichier.',
      );
    }

    if (!fs.existsSync(document.filePath)) {
      throw new NotFoundException('Le fichier physique n existe pas sur le volume de stockage.');
    }

    // Détection dynamique du MIME Type
    const fileExt = path.extname(document.filePath).toLowerCase();
    let mimeType = 'application/octet-stream';
    if (fileExt === '.pdf') mimeType = 'application/pdf';
    else if (fileExt === '.jpg' || fileExt === '.jpeg') mimeType = 'image/jpeg';
    else if (fileExt === '.png') mimeType = 'image/png';

    const fileName = path.basename(document.filePath);

    return {
      stream: fs.createReadStream(document.filePath),
      mimeType,
      fileName,
    };
  }

  // ==========================================
  // CARTE 13 : LISTE DES LITS & RÉSERVATION VERROUILLÉE
  // ==========================================

  async getFilteredBeds(filters: GetBedsFilterDto) {
    const { pavilion, floor, gender, status } = filters;

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

  async reserveBed(bedId: string, studentNumber: string) {
    const normalizedStudentNumber = studentNumber.trim();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Récupérer et vérifier l'étudiant
        const user = await tx.user.findUnique({
          where: { studentNumber: normalizedStudentNumber },
          include: {
            assignments: {
              where: { status: AssignmentStatus.ACTIVE },
            },
          },
        });

        if (!user) {
          throw new NotFoundException(
            `Étudiant avec le matricule ${normalizedStudentNumber} introuvable.`,
          );
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
        // Empêche deux requêtes simultanées de lire le lit comme AVAILABLE en même temps
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

        // 5. Attribution atomique : création de l'assignment + mise à jour du lit et de l'utilisateur
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
}