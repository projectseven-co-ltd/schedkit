// src/lib/workOrderPdf.mjs — Evidence pack PDF generator

import PDFDocument from 'pdfkit';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '../../public');
const MAX_PHOTOS = 24;

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US'); } catch { return String(iso); }
}

async function loadImageBuffer(url, baseUrl) {
  if (!url) return null;
  let path = url;
  if (url.startsWith('http')) {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch { return null; }
  }
  if (path.startsWith('/')) path = path.slice(1);
  try {
    return await readFile(join(PUBLIC_DIR, path));
  } catch { return null; }
}

export async function generateWorkOrderPdf(wo, baseUrl = 'https://schedkit.net') {
  return new Promise(async (resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Work Order Evidence Pack', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor('#444');
      doc.text(`UID: ${wo.uid || wo.Id}  ·  Generated: ${fmtDate(new Date().toISOString())}`);
      doc.fillColor('#000');
      doc.moveDown();

      doc.fontSize(14).text(wo.title || 'Untitled', { bold: true });
      doc.fontSize(10);
      doc.text(`Status: ${wo.status || '—'}  ·  Priority: ${wo.priority || 'normal'}`);
      if (wo.site_address) doc.text(`Site: ${wo.site_address}`);
      if (wo.location_name) doc.text(`Location: ${wo.location_name}`);
      doc.text(`Scheduled: ${fmtDate(wo.scheduled_start)} – ${fmtDate(wo.scheduled_end)}`);
      doc.text(`Started: ${fmtDate(wo.started_at)}  ·  Completed: ${fmtDate(wo.completed_at)}`);
      if (wo.customer_name) doc.text(`Customer: ${wo.customer_name}`);
      if (wo.description) {
        doc.moveDown(0.5);
        doc.text('Description:', { underline: true });
        doc.text(wo.description);
      }

      doc.moveDown();
      doc.fontSize(12).text('Links', { underline: true });
      doc.fontSize(10);
      if (wo.booking_id) doc.text(`Assignment ID: ${wo.booking_id}`);
      const incidentIds = (wo.incidents || []).map(i => i.ticket_id).join(', ');
      if (incidentIds) doc.text(`Linked incidents: ${incidentIds}`);

      // Timelog
      doc.moveDown();
      doc.fontSize(12).text('Time log', { underline: true });
      doc.fontSize(9);
      const entries = wo.time_entries || [];
      const totals = {};
      for (const e of entries) {
        const type = e.entry_type || 'other';
        totals[type] = (totals[type] || 0) + (Number(e.duration_minutes) || 0);
        doc.text(`${fmtDate(e.started_at)} – ${fmtDate(e.ended_at)}  [${type}]  ${e.duration_minutes ?? '—'} min  ${e.notes || ''}`);
      }
      if (!entries.length) doc.text('No time entries.');
      else {
        doc.moveDown(0.3);
        doc.text('Totals by type: ' + Object.entries(totals).map(([k, v]) => `${k}: ${v}m`).join(' · '));
      }

      // Checklist
      doc.moveDown();
      doc.fontSize(12).text('Checklist', { underline: true });
      doc.fontSize(9);
      const checklist = wo.checklist || [];
      if (!checklist.length) doc.text('No checklist items.');
      else {
        const done = checklist.filter(i => i.completed).length;
        doc.text(`${done}/${checklist.length} complete`);
        for (const item of checklist) {
          doc.text(`${item.completed ? '[x]' : '[ ]'} ${item.label}${item.required ? ' (required)' : ''}`);
        }
      }

      // Line items
      doc.moveDown();
      doc.fontSize(12).text('Parts / materials', { underline: true });
      doc.fontSize(9);
      const lines = wo.line_items || [];
      if (!lines.length) doc.text('No line items.');
      else {
        let subtotal = 0;
        for (const li of lines) {
          const qty = Number(li.quantity) || 0;
          const cost = Number(li.unit_cost) || 0;
          subtotal += qty * cost;
          doc.text(`${li.description}  ·  qty ${qty} ${li.unit || ''}  ·  $${cost.toFixed(2)}  ·  ${li.sku || ''}`);
        }
        doc.text(`Subtotal: $${subtotal.toFixed(2)}`);
      }

      // Signatures
      doc.moveDown();
      doc.fontSize(12).text('Signatures', { underline: true });
      doc.fontSize(9);
      const sigs = wo.signatures || [];
      if (!sigs.length) doc.text('No signatures captured.');
      for (const sig of sigs) {
        doc.text(`${sig.role}: ${sig.signer_name}  ·  ${fmtDate(sig.signed_at)}`);
        const img = await loadImageBuffer(sig.image_url, baseUrl);
        if (img) {
          try { doc.image(img, { width: 180, height: 60 }); } catch {}
        }
        doc.moveDown(0.3);
      }

      // Photo appendix
      doc.addPage();
      doc.fontSize(12).text('Photo appendix', { underline: true });
      doc.fontSize(9);
      const photos = (wo.attachments || []).slice(0, MAX_PHOTOS);
      if (!photos.length) doc.text('No photos attached.');
      for (const att of photos) {
        doc.text(`${att.category || 'other'}: ${att.caption || att.filename || att.url}`);
        doc.text(att.url.startsWith('http') ? att.url : `${baseUrl}${att.url}`, { link: att.url.startsWith('http') ? att.url : `${baseUrl}${att.url}`, underline: true });
        const img = await loadImageBuffer(att.url, baseUrl);
        if (img) {
          try { doc.image(img, { fit: [200, 150] }); } catch {}
        }
        doc.moveDown(0.5);
      }

      doc.fontSize(8).fillColor('#666');
      doc.text(`SchedKit · ${wo.uid || wo.Id} · ${fmtDate(new Date().toISOString())}`, 50, doc.page.height - 40);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
