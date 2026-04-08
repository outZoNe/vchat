export class CreateMessages1712563200000 {
  async up(queryRunner) {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "messages" (
        "id"         uuid DEFAULT gen_random_uuid() NOT NULL,
        "roomName"   varchar(100) NOT NULL,
        "username"   varchar(50)  NOT NULL,
        "text"       text         NOT NULL,
        "createdAt"  TIMESTAMP    NOT NULL DEFAULT now(),
        "updatedAt"  TIMESTAMP    NOT NULL DEFAULT now(),
        "deletedAt"  TIMESTAMP,
        CONSTRAINT "PK_messages" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_MESSAGES_ROOM" ON "messages" ("roomName")
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_MESSAGES_ROOM"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "messages"`);
  }
}
