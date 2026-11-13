-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('OK', 'INSUFFICIENT_BALANCE', 'ALREADY_SERVED', 'INVALID_TOKEN', 'TICKET_NOT_FOUND');

-- CreateTable
CREATE TABLE "meal_scans" (
    "id" TEXT NOT NULL,
    "student_id" TEXT,
    "controller_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "service" "MealService" NOT NULL,
    "date" DATE NOT NULL,
    "result" "ScanResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_scans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meal_scans_student_id_service_date_result_idx" ON "meal_scans"("student_id", "service", "date", "result");

-- CreateIndex
CREATE INDEX "meal_scans_controller_id_created_at_idx" ON "meal_scans"("controller_id", "created_at");

-- Only one successful meal per student, service, and service day; failed
-- attempts remain independently auditable.
CREATE UNIQUE INDEX "meal_scans_one_success_per_meal_day"
ON "meal_scans" ("student_id", "service", "date")
WHERE "result" = 'OK' AND "student_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "meal_scans" ADD CONSTRAINT "meal_scans_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_scans" ADD CONSTRAINT "meal_scans_controller_id_fkey" FOREIGN KEY ("controller_id") REFERENCES "users"("id") ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_scans" ADD CONSTRAINT "meal_scans_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON UPDATE CASCADE;
