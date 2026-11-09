-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'CONTROLLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "CodificationStatus" AS ENUM ('NOT_STARTED', 'DOCUMENTS_SUBMITTED', 'DOCUMENTS_APPROVED', 'DOCUMENTS_REJECTED', 'BED_SELECTED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "student_number" TEXT,
    "last_name" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "gender" "Gender" NOT NULL,
    "codification_status" "CodificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_student_number_key" ON "users"("student_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
