// src/routes/uploads.mjs — capture image upload, saved to disk

import { requireSession } from '../middleware/session.mjs';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { db } from '../lib/noco.mjs';
import { tables } from '../lib/tables.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = join(__dirname, '../../public/captures');
const WO_CAPTURES_DIR = join(CAPTURES_DIR, 'wo');

async function saveImage(buf, subdir, mime) {
  const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : 'jpg';
  const filename = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const dir = subdir ? join(WO_CAPTURES_DIR, subdir) : CAPTURES_DIR;
  await mkdir(dir, { recursive: true });
  const filepath = join(dir, filename);
  await writeFile(filepath, buf);
  const url = subdir ? `/captures/wo/${subdir}/${filename}` : `/captures/${filename}`;
  return { url, filename, size: buf.length };
}

export default async function uploadsRoutes(fastify) {

  // POST /v1/upload/capture
  // Accepts raw image/jpeg binary, saves to public/captures/, returns { url }
  fastify.post('/upload/capture', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Upload a capture image',
      description: 'Accept a raw JPEG, PNG, or WebP image upload from Beacon Mode or another authenticated client, save it to `public/captures`, and return a permanent static URL.',
      consumes: ['image/jpeg', 'image/webp', 'image/png'],
      response: {
        200: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            filename: { type: 'string' },
            size: { type: 'integer' },
          },
          example: {
            url: '/captures/cap_1742061600000_ab12c.jpg',
            filename: 'cap_1742061600000_ab12c.jpg',
            size: 184233,
          },
        },
      },
    },
  }, async (req, reply) => {
    const mime = req.headers['content-type'] || 'image/jpeg';
    const buf = req.body;
    if (!buf || buf.length === 0) return reply.code(400).send({ error: 'No image data' });

    const saved = await saveImage(buf, null, mime);
    return reply.send(saved);
  });

  // POST /v1/upload/work-order/:uid — WO-scoped image upload
  fastify.post('/upload/work-order/:uid', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    preHandler: requireSession,
    schema: {
      tags: ['Work Orders'],
      summary: 'Upload work order attachment image',
      consumes: ['image/jpeg', 'image/webp', 'image/png'],
    },
  }, async (req, reply) => {
    const { uid } = req.params;
    const result = await db.find(tables.work_orders, `(uid,eq,${uid})`);
    const wo = result?.list?.[0];
    if (!wo || String(wo.user_id) !== String(req.user.Id)) {
      return reply.code(404).send({ error: 'Work order not found' });
    }

    const mime = req.headers['content-type'] || 'image/jpeg';
    const buf = req.body;
    if (!buf || buf.length === 0) return reply.code(400).send({ error: 'No image data' });

    const saved = await saveImage(buf, uid, mime);
    return reply.send(saved);
  });

  // POST /v1/upload/work-order-public/:token — customer portal signature upload
  fastify.post('/upload/work-order-public/:token', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: {
      tags: ['Work Orders'],
      summary: 'Upload signature image (customer portal)',
      consumes: ['image/png', 'image/jpeg'],
    },
  }, async (req, reply) => {
    const result = await db.find(tables.work_orders, `(customer_token,eq,${req.params.token})`);
    const wo = result?.list?.[0];
    if (!wo) return reply.code(404).send({ error: 'Not found' });

    const mime = req.headers['content-type'] || 'image/png';
    const buf = req.body;
    if (!buf || buf.length === 0) return reply.code(400).send({ error: 'No image data' });

    const saved = await saveImage(buf, `${wo.uid}/signatures`, mime);
    return reply.send(saved);
  });
}
