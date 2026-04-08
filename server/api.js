import { randomUUID } from 'crypto';
import { createWriteStream, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import { extname, join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import { AppDataSource } from './db/data-source.js';
import { Message } from './db/entities/Message.js';
import { Attachment } from './db/entities/Attachment.js';
import { broadcastToRoom } from './server.js';

const UPLOADS_DIR = '/app/uploads';
const MAX_FILES = 10;
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

mkdirSync(UPLOADS_DIR, { recursive: true });

const fastify = Fastify({ logger: false });

await fastify.register(cors, { origin: true });
await fastify.register(staticPlugin, {
  root: UPLOADS_DIR,
  prefix: '/uploads/',
  decorateReply: false,
});
await fastify.register(multipart, {
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

const messageRepo = () => AppDataSource.getRepository(Message);
const attachmentRepo = () => AppDataSource.getRepository(Attachment);

// GET /messages?roomName=PVP-1&limit=50&before=<uuid>
fastify.get('/messages', async (req, reply) => {
  const { roomName, limit = 50, before } = req.query;
  if (!roomName) return reply.code(400).send({ error: 'roomName required' });

  const qb = messageRepo()
    .createQueryBuilder('m')
    .leftJoinAndSelect('m.attachments', 'a')
    .where('m.roomName = :roomName', { roomName })
    .andWhere('m.deletedAt IS NULL')
    .orderBy('m.createdAt', 'DESC')
    .take(Math.min(Number(limit), 200));

  if (before) {
    const cursor = await messageRepo().findOneBy({ id: before });
    if (cursor) {
      qb.andWhere('m.createdAt < :ts', { ts: cursor.createdAt });
    }
  }

  const messages = await qb.getMany();
  return messages.reverse().map(formatMessage);
});

// POST /upload  (multipart: roomName, text?, files)
fastify.post('/upload', async (req, reply) => {
  const parts = req.parts();
  const fields = {};
  const files = [];

  for await (const part of parts) {
    if (part.type === 'field') {
      fields[part.fieldname] = part.value;
    } else if (part.type === 'file') {
      if (files.length >= MAX_FILES) {
        // drain remaining
        await part.toBuffer();
        continue;
      }
      const ext = extname(part.filename) || '';
      const storageName = `${randomUUID()}${ext}`;
      const storagePath = join(UPLOADS_DIR, storageName);

      await pipeline(part.file, createWriteStream(storagePath));

      if (part.file.truncated) {
        return reply.code(413).send({ error: `Файл "${part.filename}" превышает 50 МБ` });
      }

      files.push({
        filename: part.filename,
        storagePath: storageName,
        mimeType: part.mimetype || 'application/octet-stream',
        size: part.file.bytesRead,
      });
    }
  }

  const { roomName, username } = fields;
  const text = (fields.text || '').trim().slice(0, 2000);

  if (!roomName || !username) {
    return reply.code(400).send({ error: 'roomName and username required' });
  }
  if (!text && files.length === 0) {
    return reply.code(400).send({ error: 'text or files required' });
  }

  // Save in transaction
  const result = await AppDataSource.transaction(async (em) => {
    const msg = em.getRepository(Message).create({
      roomName,
      username,
      text: text || '',
    });
    const savedMsg = await em.getRepository(Message).save(msg);

    let savedAttachments = [];
    if (files.length > 0) {
      const attachments = files.map((f) =>
        em.getRepository(Attachment).create({
          messageId: savedMsg.id,
          ...f,
        })
      );
      savedAttachments = await em.getRepository(Attachment).save(attachments);
    }

    return { message: savedMsg, attachments: savedAttachments };
  });

  const chatMsg = formatMessage({ ...result.message, attachments: result.attachments });
  broadcastToRoom(roomName, 'chatMessage', { data: chatMsg });

  return chatMsg;
});

function formatMessage(msg) {
  return {
    id: msg.id,
    username: msg.username,
    text: msg.text,
    createdAt: msg.createdAt,
    attachments: (msg.attachments || []).map((a) => ({
      id: a.id,
      filename: a.filename,
      url: `/uploads/${a.storagePath}`,
      mimeType: a.mimeType,
      size: a.size,
    })),
  };
}

export async function startApi(port = 8081) {
  await fastify.listen({ port, host: '0.0.0.0' });
  console.log(`API server running on port ${port}`);
}
