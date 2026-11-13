import { type Prisma } from '@prisma/client';

export const JWT_ACCESS_TOKEN_TTL = '1h';
export const JWT_ACCESS_TOKEN_TTL_SECONDS = 3600;
export const BCRYPT_SALT_ROUNDS = 12;

export const PUBLIC_USER_SELECT = {
  id: true,
  studentNumber: true,
  lastName: true,
  firstName: true,
  email: true,
  role: true,
  gender: true,
  codificationStatus: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export type AuthenticatedUser = Prisma.UserGetPayload<{
  select: typeof PUBLIC_USER_SELECT;
}>;
