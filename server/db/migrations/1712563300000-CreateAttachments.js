export class CreateAttachments1712563300000 {
  async up(queryRunner) {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attachments" (
        "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
        "messageId"   uuid NOT NULL,
        "filename"    varchar(255) NOT NULL,
        "storagePath" varchar(500) NOT NULL,
        "mimeType"    varchar(100) NOT NULL DEFAULT 'application/octet-stream',
        "size"        integer NOT NULL,
        "createdAt"   TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_attachments_message" FOREIGN KEY ("messageId")
          REFERENCES "messages"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ATTACHMENTS_MESSAGE" ON "attachments" ("messageId")
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ATTACHMENTS_MESSAGE"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attachments"`);
  }
}
