import { BadRequestException } from '@nestjs/common';
import { Gender } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { parseStudentsCsv } from './csv-import';

const csv = (text: string) => Buffer.from(text, 'utf-8');

describe('parseStudentsCsv', () => {
  it('reads English columns and keeps F as FEMALE (it used to become MALE)', () => {
    const [student] = parseStudentsCsv(
      csv(
        'student_number,last_name,first_name,birth_date,genre,level,email\n20260001,Diop,Awa,2002-05-15,F,L2,AWA@example.com\n',
      ),
    );
    expect(student).toMatchObject({
      studentNumber: '20260001',
      genre: Gender.FEMALE,
      level: 'L2',
      email: 'awa@example.com',
    });
    expect(student.birthDate.toISOString()).toBe('2002-05-15T00:00:00.000Z');
  });

  it('reads the French headers, ; delimiter, BOM and JJ/MM/AAAA dates', () => {
    const [student] = parseStudentsCsv(
      csv(
        '\uFEFFNuméro étudiant;Nom;Prénom;Date de naissance;Genre;Niveau;Email\n20260002;Ndiaye;Moussa;03/11/2001;Homme;M1;moussa@example.com\n',
      ),
    );
    expect(student).toMatchObject({ genre: Gender.MALE, firstName: 'Moussa' });
    expect(student.birthDate.toISOString()).toBe('2001-11-03T00:00:00.000Z');
  });

  it('rejects unknown genders, impossible dates and duplicates with the line number', () => {
    const header = 'student_number,last_name,first_name,birth_date,genre,level,email\n';
    expect(() =>
      parseStudentsCsv(csv(`${header}1,A,B,2000-01-01,X,L1,a@x.sn\n`)),
    ).toThrow(/Ligne 2 : genre invalide/);
    expect(() =>
      parseStudentsCsv(csv(`${header}1,A,B,2000-02-31,M,L1,a@x.sn\n`)),
    ).toThrow(/Ligne 2 : date de naissance inexistante/);
    expect(() =>
      parseStudentsCsv(
        csv(`${header}1,A,B,2000-01-01,M,L1,a@x.sn\n1,C,D,2000-01-01,M,L1,c@x.sn\n`),
      ),
    ).toThrow(/Ligne 3 : numéro étudiant en double/);
    expect(() =>
      parseStudentsCsv(
        csv(`${header}1,A,B,2000-01-01,M,L1,a@x.sn\n2,C,D,2000-01-01,M,L1,A@x.sn\n`),
      ),
    ).toThrow(/Ligne 3 : adresse e-mail en double/);
  });

  it('lists the missing columns', () => {
    expect(() => parseStudentsCsv(csv('nom,prenom\nA,B\n'))).toThrow(
      /Colonnes manquantes : studentNumber, birthDate, genre, level, email/,
    );
    expect(() => parseStudentsCsv(Buffer.alloc(0))).toThrow(BadRequestException);
  });
});
