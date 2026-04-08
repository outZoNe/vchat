import { EntitySchema } from 'typeorm';

export const Attachment = new EntitySchema({
  name: 'Attachment',
  tableName: 'attachments',
  columns: {
    id: {
      type: 'uuid',
      primary: true,
      generated: 'uuid',
    },
    messageId: {
      type: 'uuid',
    },
    filename: {
      type: 'varchar',
      length: 255,
    },
    storagePath: {
      type: 'varchar',
      length: 500,
    },
    mimeType: {
      type: 'varchar',
      length: 100,
      default: 'application/octet-stream',
    },
    size: {
      type: 'integer',
    },
    createdAt: {
      type: 'timestamp',
      createDate: true,
    },
  },
  relations: {
    message: {
      type: 'many-to-one',
      target: 'Message',
      joinColumn: { name: 'messageId' },
      onDelete: 'CASCADE',
    },
  },
  indices: [
    {
      name: 'IDX_ATTACHMENTS_MESSAGE',
      columns: ['messageId'],
    },
  ],
});
