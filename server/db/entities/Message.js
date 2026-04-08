import { EntitySchema } from 'typeorm';

export const Message = new EntitySchema({
  name: 'Message',
  tableName: 'messages',
  columns: {
    id: {
      type: 'uuid',
      primary: true,
      generated: 'uuid',
    },
    roomName: {
      type: 'varchar',
      length: 100,
    },
    username: {
      type: 'varchar',
      length: 50,
    },
    text: {
      type: 'text',
    },
    createdAt: {
      type: 'timestamp',
      createDate: true,
    },
    updatedAt: {
      type: 'timestamp',
      updateDate: true,
    },
    deletedAt: {
      type: 'timestamp',
      nullable: true,
      deleteDate: true,
    },
  },
  relations: {
    attachments: {
      type: 'one-to-many',
      target: 'Attachment',
      inverseSide: 'message',
    },
  },
  indices: [
    {
      name: 'IDX_MESSAGES_ROOM',
      columns: ['roomName'],
    },
  ],
});
