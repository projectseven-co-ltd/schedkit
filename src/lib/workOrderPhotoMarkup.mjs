// Burn photo markup annotations into a raster for PDF / exports

import sharp from 'sharp';

export function parseAnnotations(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function arrowHeadPoints(x1, y1, x2, y2, head = 14) {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return {
    hx1: x2 - head * Math.cos(angle - 0.4),
    hy1: y2 - head * Math.sin(angle - 0.4),
    hx2: x2 - head * Math.cos(angle + 0.4),
    hy2: y2 - head * Math.sin(angle + 0.4),
  };
}

function annotationToSvg(ann, width, height) {
  const x1 = ann.x1 * width;
  const y1 = ann.y1 * height;
  const x2 = ann.x2 * width;
  const y2 = ann.y2 * height;
  const color = ann.color || '#ff3333';
  const stroke = 4;

  if (ann.type === 'line') {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>`;
  }

  const { hx1, hy1, hx2, hy2 } = arrowHeadPoints(x1, y1, x2, y2);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"/>
    <polygon points="${x2},${y2} ${hx1},${hy1} ${hx2},${hy2}" fill="${color}"/>`;
}

export function annotationsToSvg(annotations, width, height) {
  const shapes = (annotations || [])
    .filter(a => a && typeof a.x1 === 'number')
    .map(a => annotationToSvg(a, width, height))
    .join('');
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${shapes}</svg>`;
}

/** Composite markup onto image bytes; returns original buffer when no annotations. */
export async function renderAttachmentWithMarkup(imageBuffer, annotationsRaw) {
  const annotations = parseAnnotations(annotationsRaw);
  if (!imageBuffer || !annotations.length) return imageBuffer;

  const meta = await sharp(imageBuffer).metadata();
  const width = meta.width;
  const height = meta.height;
  if (!width || !height) return imageBuffer;

  const overlay = Buffer.from(annotationsToSvg(annotations, width, height));
  return sharp(imageBuffer)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}
