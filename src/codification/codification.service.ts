import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as Papa from 'papaparse';
import { Gender } from '@prisma/client';
import { VerifyStudentDto } from './dto/verify-student.dto';

@Injectable()
export class CodificationService {
  constructor(private readonly prisma: PrismaService) {}

  async importCodifiableStudents(fileBuffer: Buffer) {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('Le fichier CSV transmis est vide');
    }

    // Retrait du BOM UTF-8 potentiel (\ufeff)
    const csvString = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');

    // Papa.parse avec auto-détection du séparateur (virgule, point-virgule, tab)
    const parseResult = Papa.parse<Record<string, string>>(csvString, {
      header: true,
      skipEmptyLines: true,
      delimitersToGuess: [',', ';', '\t'],
    });

    if (parseResult.errors && parseResult.errors.length > 0) {
      // Ignorer l'erreur d'auto-détection si des données ont tout de même été extraites
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

    // Fonction helper pour normaliser les clés (ex: "student_number" ou "Student Number" -> "studentnumber")
    const normalizeKey = (key: string) =>
      key.trim().toLowerCase().replace(/[\s_]+/g, '');

    // Liste des clés attendues sous forme normalisée
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

      // Map des clés normalisées vers leurs valeurs
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

      // Validation de la présence des valeurs obligatoires
      if (!studentNumber || !lastName || !firstName || !birthDateRaw || !email) {
        throw new BadRequestException(`Ligne ${i + 2}: Champs obligatoires manquants`);
      }

      // Validation et conversion de la date
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

    // Transction Prisma avec Upsert pour l'atomicité et l'anti-doublon
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
}