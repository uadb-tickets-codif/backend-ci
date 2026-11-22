import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BedStatus,
  CodificationStatus,
  DocStatus,
  Gender,
  Role,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.constants';
import type { PrismaService } from '../prisma/prisma.service';
import { CodificationService, type MulterFile } from './codification.service';
import { ValidateDocumentDto } from './dto/validate-document.dto';

type Row = Record<string, unknown>;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = Buffer.from('%PDF-1.4 test');

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    studentNumber: '20260001',
    lastName: 'Diop',
    firstName: 'Awa',
    email: 'awa@example.com',
    role: Role.STUDENT,
    gender: Gender.FEMALE,
    codificationStatus: CodificationStatus.NOT_STARTED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

async function drain(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

function file(buffer: Buffer, originalname: string, mimetype: string): MulterFile {
  return { fieldname: 'f', originalname, encoding: '7bit', mimetype, size: buffer.length, buffer };
}

describe('CodificationService', () => {
  let tmpDir: string;
  let service: CodificationService;
  let students: Map<string, Row>;
  let users: Map<string, Row>;
  let documents: Row[];
  let beds: Map<string, Row>;
  let assignments: Row[];
  let prisma: Record<string, unknown>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codif-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    students = new Map([
      [
        '20260001',
        {
          id: 'cs-1',
          studentNumber: '20260001',
          firstName: 'Awa',
          lastName: 'Diop',
          birthDate: new Date('2002-05-15T00:00:00.000Z'),
          genre: Gender.FEMALE,
          level: 'L2',
          email: 'awa@example.com',
        },
      ],
    ]);
    users = new Map([['user-1', { id: 'user-1' }]]);
    documents = [];
    beds = new Map();
    assignments = [];

    const client: Record<string, unknown> = {
      codifiableStudent: {
        findUnique: vi.fn(
          async ({ where }: { where: { studentNumber: string } }) =>
            students.get(where.studentNumber) ?? null,
        ),
      },
      user: {
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          const user = users.get(where.id) ?? {};
          Object.assign(user, data);
          users.set(where.id, user);
          return user;
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const user = users.get(where.id);
          return user
            ? { ...user, assignments: assignments.filter((a) => a.userId === where.id) }
            : null;
        }),
      },
      document: {
        findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
          documents.filter((document) => document.userId === where.userId),
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            documents.find((document) => document.id === where.id) ?? null,
        ),
        deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => {
          documents = documents.filter((document) => !where.id.in.includes(document.id as string));
          return { count: 1 };
        }),
        createMany: vi.fn(async ({ data }: { data: Row[] }) => {
          documents.push(...data.map((row, index) => ({ id: `doc-${documents.length + index + 1}`, ...row })));
          return { count: data.length };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          const document = documents.find((item) => item.id === where.id)!;
          Object.assign(document, data);
          return document;
        }),
      },
      room: {
        findUnique: vi.fn(async () => ({
          id: 'room-1',
          pavilion: { name: 'Pavillon A', gender: Gender.FEMALE },
        })),
      },
      bed: {
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          Object.assign(beds.get(where.id)!, data);
        }),
      },
      assignment: {
        create: vi.fn(async ({ data }: { data: Row }) => {
          const assignment = { id: `assignment-${assignments.length + 1}`, ...data };
          assignments.push(assignment);
          return assignment;
        }),
      },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (sql.includes('FROM beds')) {
          const bed = beds.get(values[0] as string);
          return bed ? [bed] : [];
        }
        return [{ id: values[0] }];
      }),
    };
    client.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(client),
    );
    prisma = client;

    service = new CodificationService(prisma as unknown as PrismaService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('verifyStudentEligibility', () => {
    it('links the matricule and the official gender to the account once the birth date matches', async () => {
      const result = await service.verifyStudentEligibility(
        makeUser({ studentNumber: null, gender: Gender.MALE }),
        { studentNumber: ' 20260001 ', birthDate: '2002-05-15' },
      );

      expect(result).toMatchObject({ eligible: true, student: { studentNumber: '20260001' } });
      expect(users.get('user-1')).toMatchObject({
        studentNumber: '20260001',
        gender: Gender.FEMALE,
      });
    });

    it('gives the same answer for an unknown matricule and a wrong birth date', async () => {
      const user = makeUser({ studentNumber: null });
      const unknown = service.verifyStudentEligibility(user, {
        studentNumber: '99999999',
        birthDate: '2002-05-15',
      });
      const wrongDate = service.verifyStudentEligibility(user, {
        studentNumber: '20260001',
        birthDate: '2001-01-01',
      });

      await expect(unknown).rejects.toBeInstanceOf(NotFoundException);
      await expect(wrongDate).rejects.toBeInstanceOf(NotFoundException);
      expect((await unknown.catch((e: Error) => e.message))).toBe(
        await wrongDate.catch((e: Error) => e.message),
      );
      expect(users.get('user-1')).not.toHaveProperty('studentNumber');
    });

    it('refuses a matricule that is not the one already linked to the account', async () => {
      await expect(
        service.verifyStudentEligibility(makeUser({ studentNumber: '20260009' }), {
          studentNumber: '20260001',
          birthDate: '2002-05-15',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('uploadStudentDocuments', () => {
    it('stores both documents under the account folder with their real type', async () => {
      await service.uploadStudentDocuments(makeUser(), {
        cni: [file(PNG, '../../ma cni?.exe', 'image/png')],
        studentCard: [file(PDF, 'carte.pdf', 'application/pdf')],
      });

      expect(documents).toHaveLength(2);
      const cni = documents.find((document) => document.type === 'CNI')!;
      expect(cni).toMatchObject({
        status: DocStatus.PENDING,
        mimeType: 'image/png',
        fileName: 'ma cni_.png',
      });
      expect((cni.filePath as string).startsWith(path.join(tmpDir, 'uploads', 'documents', 'user-1'))).toBe(true);
      expect(path.extname(cni.filePath as string)).toBe('.png');
      expect(fs.existsSync(cni.filePath as string)).toBe(true);
      expect(users.get('user-1')).toMatchObject({
        codificationStatus: CodificationStatus.DOCUMENTS_SUBMITTED,
      });
    });

    it('rejects a file whose content is not a PDF/JPG/PNG even if it is named .png', async () => {
      await expect(
        service.uploadStudentDocuments(makeUser(), {
          cni: [file(Buffer.from('<script>alert(1)</script>'), 'cni.png', 'image/png')],
          studentCard: [file(PDF, 'carte.pdf', 'application/pdf')],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documents).toHaveLength(0);
    });

    it('requires a verified matricule and a dossier that is still editable', async () => {
      const files = { cni: [file(PNG, 'a.png', 'image/png')], studentCard: [file(PNG, 'b.png', 'image/png')] };
      await expect(
        service.uploadStudentDocuments(makeUser({ studentNumber: null }), files),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.uploadStudentDocuments(
          makeUser({ codificationStatus: CodificationStatus.DOCUMENTS_APPROVED }),
          files,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('replaces previous documents and deletes their old files', async () => {
      const first = { cni: [file(PNG, 'a.png', 'image/png')], studentCard: [file(PNG, 'b.png', 'image/png')] };
      await service.uploadStudentDocuments(makeUser(), first);
      const oldPaths = documents.map((document) => document.filePath as string);

      await service.uploadStudentDocuments(
        makeUser({ codificationStatus: CodificationStatus.DOCUMENTS_REJECTED }),
        first,
      );

      expect(documents).toHaveLength(2);
      for (const oldPath of oldPaths) expect(fs.existsSync(oldPath)).toBe(false);
      for (const document of documents) expect(fs.existsSync(document.filePath as string)).toBe(true);
    });
  });

  describe('getSecureDocumentStream', () => {
    beforeEach(() => {
      const folder = path.join(tmpDir, 'uploads', 'documents', 'user-1');
      fs.mkdirSync(folder, { recursive: true });
      const filePath = path.join(folder, 'cni_x.png');
      fs.writeFileSync(filePath, PNG);
      documents = [
        { id: 'doc-1', userId: 'user-1', filePath, fileName: 'cni.png', mimeType: 'image/png' },
        { id: 'doc-evil', userId: 'user-1', filePath: '/etc/passwd', fileName: null, mimeType: null },
      ];
    });

    it('serves the owner and any administrator, nobody else', async () => {
      const owner = await service.getSecureDocumentStream('doc-1', makeUser());
      expect(owner.mimeType).toBe('image/png');
      expect(await drain(owner.stream)).toEqual(PNG);

      const admin = await service.getSecureDocumentStream(
        'doc-1',
        makeUser({ id: 'admin-1', role: Role.ADMIN }),
      );
      expect(await drain(admin.stream)).toEqual(PNG);

      await expect(
        service.getSecureDocumentStream('doc-1', makeUser({ id: 'user-2', studentNumber: '20260002' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never reads outside the upload folder', async () => {
      await expect(
        service.getSecureDocumentStream('doc-evil', makeUser({ role: Role.ADMIN })),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('validateDocumentByAdmin', () => {
    beforeEach(() => {
      users.set('user-1', { id: 'user-1', codificationStatus: CodificationStatus.DOCUMENTS_SUBMITTED });
      documents = [
        { id: 'doc-1', userId: 'user-1', type: 'CNI', status: DocStatus.PENDING },
        { id: 'doc-2', userId: 'user-1', type: 'STUDENT_CARD', status: DocStatus.PENDING },
      ];
      const documentClient = (prisma.document as Record<string, unknown>);
      documentClient.findUnique = vi.fn(async ({ where }: { where: { id: string } }) => {
        const document = documents.find((item) => item.id === where.id);
        return document ? { ...document, user: { codificationStatus: users.get('user-1')!.codificationStatus } } : null;
      });
    });

    it('approves the dossier only when every document is approved', async () => {
      await service.validateDocumentByAdmin('doc-1', { status: DocStatus.APPROVED });
      expect(users.get('user-1')!.codificationStatus).toBe(CodificationStatus.DOCUMENTS_SUBMITTED);

      await service.validateDocumentByAdmin('doc-2', { status: DocStatus.APPROVED });
      expect(users.get('user-1')!.codificationStatus).toBe(CodificationStatus.DOCUMENTS_APPROVED);
    });

    it('rejects the dossier as soon as one document is rejected, with its reason', async () => {
      const result = await service.validateDocumentByAdmin('doc-1', {
        status: DocStatus.REJECTED,
        rejectionReason: 'CNI illisible',
      });
      expect(result.document).toMatchObject({ rejectionReason: 'CNI illisible' });
      expect(users.get('user-1')!.codificationStatus).toBe(CodificationStatus.DOCUMENTS_REJECTED);
    });

    it('does not touch a dossier whose student already has a bed', async () => {
      users.get('user-1')!.codificationStatus = CodificationStatus.BED_SELECTED;
      await expect(
        service.validateDocumentByAdmin('doc-1', { status: DocStatus.APPROVED }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('requires a reason for a rejection and refuses the PENDING status (DTO validation)', async () => {
      const noReason = plainToInstance(ValidateDocumentDto, { status: DocStatus.REJECTED });
      expect(await validate(noReason)).not.toHaveLength(0);

      const pending = plainToInstance(ValidateDocumentDto, { status: DocStatus.PENDING });
      expect(await validate(pending)).not.toHaveLength(0);

      const ok = plainToInstance(ValidateDocumentDto, { status: DocStatus.APPROVED });
      expect(await validate(ok)).toHaveLength(0);
    });
  });

  describe('getMyCodification', () => {
    it('returns the status, the documents with rejection reasons and the active bed', async () => {
      documents = [
        { id: 'doc-1', userId: 'user-1', type: 'CNI', status: DocStatus.REJECTED, rejectionReason: 'Illisible' },
        { id: 'doc-2', userId: 'someone-else', type: 'CNI', status: DocStatus.APPROVED },
      ];
      (prisma as Record<string, unknown>).assignment = {
        ...(prisma.assignment as Record<string, unknown>),
        findFirst: vi.fn(async () => ({
          id: 'assignment-1',
          bed: { label: 'L1', room: { number: 'A-108', floor: 1, pavilion: { name: 'Pavillon A' } } },
        })),
      };

      const result = await service.getMyCodification(
        makeUser({ codificationStatus: CodificationStatus.DOCUMENTS_REJECTED }),
      );

      expect(result.codificationStatus).toBe(CodificationStatus.DOCUMENTS_REJECTED);
      expect(result.documents).toEqual([expect.objectContaining({ id: 'doc-1', rejectionReason: 'Illisible' })]);
      expect(result.assignment).toMatchObject({ bed: { room: { pavilion: { name: 'Pavillon A' } } } });
    });
  });

  describe('reserveBed', () => {
    beforeEach(() => {
      users.set('user-1', {
        id: 'user-1',
        gender: Gender.FEMALE,
        codificationStatus: CodificationStatus.DOCUMENTS_APPROVED,
      });
      beds.set('bed-1', { id: 'bed-1', status: BedStatus.AVAILABLE, room_id: 'room-1' });
    });

    it('books the bed for the authenticated student and updates her status', async () => {
      const result = await service.reserveBed('bed-1', makeUser());

      expect(result).toMatchObject({ success: true });
      expect(assignments[0]).toMatchObject({ userId: 'user-1', bedId: 'bed-1' });
      expect(beds.get('bed-1')!.status).toBe(BedStatus.OCCUPIED);
      expect(users.get('user-1')!.codificationStatus).toBe(CodificationStatus.BED_SELECTED);
    });

    it('refuses unapproved dossiers, taken beds, second beds and the wrong pavilion gender', async () => {
      users.get('user-1')!.codificationStatus = CodificationStatus.DOCUMENTS_SUBMITTED;
      await expect(service.reserveBed('bed-1', makeUser())).rejects.toBeInstanceOf(ForbiddenException);

      users.get('user-1')!.codificationStatus = CodificationStatus.DOCUMENTS_APPROVED;
      beds.get('bed-1')!.status = BedStatus.OCCUPIED;
      await expect(service.reserveBed('bed-1', makeUser())).rejects.toBeInstanceOf(ConflictException);

      beds.get('bed-1')!.status = BedStatus.AVAILABLE;
      assignments.push({ userId: 'user-1', status: 'ACTIVE' });
      await expect(service.reserveBed('bed-1', makeUser())).rejects.toBeInstanceOf(ConflictException);

      assignments.length = 0;
      users.get('user-1')!.gender = Gender.MALE;
      await expect(service.reserveBed('bed-1', makeUser())).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
