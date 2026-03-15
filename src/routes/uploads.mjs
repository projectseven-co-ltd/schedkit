// src/routes/uploads.mjs — file upload proxy to NocoDB storage

import { requireSession } from '../middleware/session.mjs';

const NOCO_BASE = process.env.NOCO_BASE_URL || 'https://noco.app.p7n.net';
const NOCO_TOKEN = process.env.NOCO_API_TOKEN;
const UPLOAD_PATH = 'noco/pdrfbzgtno2cf9l/m21ubw2908iz01s/image_url';

export default async function uploadsRoutes(fastify) {

  // POST /v1/upload/capture
  // Accepts raw image binary (Content-Type: image/jpeg or image/webp)
  // Returns { url } — permanent NocoDB storage path (not signed)
  fastify.post('/upload/capture', {
    preHandler: requireSession,
    config: { rawBody: true },
    schema: {
      tags: ['Signals'],
      summary: 'Upload a capture image to NocoDB storage',
      consumes: ['image/jpeg', 'image/webp', 'image/png'],
    },
  }, async (req, reply) => {
    const mime = req.headers['content-type'] || 'image/jpeg';
    const ext = mime.includes('webp') ? 'webp' : mime.includes('png') ? 'png' : 'jpg';
    const filename = `capture_${Date.now()}.${ext}`;

    // Get raw body
    const rawBody = req.rawBody || await req.body;
    if (!rawBody || rawBody.length === 0) {
      return reply.code(400).send({ error: 'No image data' });
    }

    // Build multipart form manually (simple boundary approach)
    const boundary = '----NocoBoundary' + Math.random().toString(36).slice(2);
    const bodyParts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
    ];
    const prefix = Buffer.from(bodyParts[0]);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const imgBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
    const multipartBody = Buffer.concat([prefix, imgBuf, suffix]);

    const res = await fetch(
      `${NOCO_BASE}/api/v1/db/storage/upload?path=${UPLOAD_PATH}`,
      {
        method: 'POST',
        headers: {
          'xc-token': NOCO_TOKEN,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody,
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      fastify.log.error('NocoDB upload error: ' + txt);
      return reply.code(500).send({ error: 'Upload failed: ' + txt.slice(0, 200) });
    }

    const json = await res.json();
    const file = Array.isArray(json) ? json[0] : json;
    // Return the permanent (non-signed) URL
    return reply.send({ url: file.url, title: file.title, size: file.size });
  });

  // GET /v1/upload/image?path=...
  // Re-signs and redirects to a fresh signed URL
  fastify.get('/upload/image', {
    preHandler: requireSession,
    schema: {
      tags: ['Signals'],
      summary: 'Get a signed URL for a stored capture image',
      querystring: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  }, async (req, reply) => {
    const { path: imgPath } = req.query;
    // Extract just the filename from a full URL if needed
    const filename = imgPath.includes('/nc/uploads/') ? imgPath.split('/nc/uploads/')[1] : imgPath;
    const signRes = await fetch(
      `${NOCO_BASE}/api/v1/db/storage/upload-by-url?path=${encodeURIComponent(filename)}`,
      { headers: { 'xc-token': NOCO_TOKEN } }
    ).catch(() => null);

    // Simpler: just redirect to the NocoDB signed URL endpoint
    // NocoDB has a /download endpoint that re-signs
    const signedUrl = `${NOCO_BASE}/api/v1/db/storage/download?path=${encodeURIComponent(filename)}&xc-token=${NOCO_TOKEN}`;
    return reply.redirect(signedUrl);
  });
}
