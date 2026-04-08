import { DataSource } from 'typeorm';
import { Message } from './entities/Message.js';
import { Attachment } from './entities/Attachment.js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'vchat_postgres',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'secret5',
  database: process.env.DB_NAME || 'vchat_db',
  synchronize: false,
  migrationsRun: true,
  entities: [Message, Attachment],
  migrations: ['./db/migrations/*.js'],
});
