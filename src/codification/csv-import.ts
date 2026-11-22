import { BadRequestException } from '@nestjs/common';
import { Gender } from '@prisma/client';
import * as Papa from 'papaparse';

export interface ParsedStudent {
  studentNumber: string;
  lastName: string;
  firstName: string;
  birthDate: Date;
  genre: Gender;
  level: string;
  email: string;
}

const normalizeKey = (key: string) =>
  key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

// Colonnes acceptées (anglais, ou français comme dans l'interface).
const COLUMN_ALIASES = {
  studentNumber: ['studentnumber', 'numeroetudiant', 'numetudiant', 'matricule'],
  lastName: ['lastname', 'nom'],
  firstName: ['firstname', 'prenom', 'prenoms'],
  birthDate: ['birthdate', 'datedenaissance', 'datenaissance'],
  genre: ['genre', 'gender', 'sexe'],
  level: ['level', 'niveau'],
  email: ['email', 'courriel', 'mail', 'adresseemail'],
} as const;

type Column = keyof typeof COLUMN_ALIASES;

const MALE_VALUES = ['m', 'h', 'male', 'masculin', 'homme', 'garcon'];
const FEMALE_VALUES = ['f', 'female', 'feminin', 'femme', 'fille'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseGender(raw: string, line: number): Gender {
  const value = normalizeKey(raw);
  if (MALE_VALUES.includes(value)) return Gender.MALE;
  if (FEMALE_VALUES.includes(value)) return Gender.FEMALE;
  throw new BadRequestException(
    `Ligne ${line} : genre invalide (${raw || 'vide'}). Utilisez M ou F.`,
  );
}

function parseBirthDate(raw: string, line: number): Date {
  const value = raw.trim();
  let year: number, month: number, day: number;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  const french = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (french) {
    [day, month, year] = [Number(french[1]), Number(french[2]), Number(french[3])];
  } else {
    throw new BadRequestException(
      `Ligne ${line} : date de naissance invalide (${raw}). Format attendu : AAAA-MM-JJ ou JJ/MM/AAAA.`,
    );
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(
      `Ligne ${line} : date de naissance inexistante (${raw}).`,
    );
  }
  return date;
}

export function parseStudentsCsv(fileBuffer: Buffer): ParsedStudent[] {
  if (!fileBuffer || fileBuffer.length === 0) {
    throw new BadRequestException('Le fichier CSV transmis est vide');
  }

  const csvString = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');
  const parseResult = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
    delimitersToGuess: [',', ';', '\t'],
  });

  if (parseResult.errors.length > 0 && parseResult.data.length === 0) {
    throw new BadRequestException(
      `Erreur de lecture du fichier CSV: ${parseResult.errors[0].message}`,
    );
  }

  const rows = parseResult.data;
  if (rows.length === 0) {
    throw new BadRequestException('Le fichier CSV ne contient aucune donnée');
  }

  // Colonne du fichier correspondant à chaque champ attendu.
  const headers = Object.keys(rows[0]);
  const columnFor = {} as Record<Column, string>;
  const missing: string[] = [];
  for (const column of Object.keys(COLUMN_ALIASES) as Column[]) {
    const header = headers.find((candidate) =>
      (COLUMN_ALIASES[column] as readonly string[]).includes(normalizeKey(candidate)),
    );
    if (header === undefined) missing.push(column);
    else columnFor[column] = header;
  }
  if (missing.length > 0) {
    throw new BadRequestException(
      `Colonnes manquantes : ${missing.join(', ')}. Colonnes attendues : student_number, last_name, first_name, birth_date, genre, level, email (ou leurs équivalents français : numéro étudiant, nom, prénom, date de naissance, genre, niveau, email).`,
    );
  }

  const seenNumbers = new Set<string>();
  const seenEmails = new Set<string>();

  return rows.map((row, index) => {
    const line = index + 2;
    const value = (column: Column) => String(row[columnFor[column]] ?? '').trim();

    const studentNumber = value('studentNumber');
    const lastName = value('lastName');
    const firstName = value('firstName');
    const level = value('level');
    const email = value('email').toLowerCase();

    if (!studentNumber || !lastName || !firstName || !value('birthDate') || !level || !email) {
      throw new BadRequestException(`Ligne ${line} : champs obligatoires manquants`);
    }
    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException(`Ligne ${line} : adresse e-mail invalide (${email}).`);
    }
    if (seenNumbers.has(studentNumber)) {
      throw new BadRequestException(`Ligne ${line} : numéro étudiant en double (${studentNumber}).`);
    }
    if (seenEmails.has(email)) {
      throw new BadRequestException(`Ligne ${line} : adresse e-mail en double (${email}).`);
    }
    seenNumbers.add(studentNumber);
    seenEmails.add(email);

    return {
      studentNumber,
      lastName,
      firstName,
      birthDate: parseBirthDate(value('birthDate'), line),
      genre: parseGender(value('genre'), line),
      level,
      email,
    };
  });
}
