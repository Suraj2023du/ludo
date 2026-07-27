/**
 * tools/make-icons.js — generate the two PWA install icons.
 *
 * Writes real PNGs with a hand-rolled encoder (node:zlib only, zero deps), so
 * the repo carries no binary art we cannot regenerate.
 *
 *   node tools/make-icons.js
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'icons');

/* ─────────────────────────────── PNG encoder ─────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** @param {Uint8Array} rgba width*height*4 */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ──────────────────────────────── the artwork ─────────────────────────────── */

const COLORS = {
  bg: [18, 33, 58, 255],
  board: [253, 250, 241, 255],
  red: [230, 57, 70, 255],
  green: [42, 157, 74, 255],
  yellow: [244, 185, 60, 255],
  blue: [47, 116, 208, 255],
  frame: [13, 27, 48, 255],
};

function put(px, w, x, y, rgba, alpha = 1) {
  const i = (y * w + x) * 4;
  if (alpha >= 1) {
    px[i] = rgba[0];
    px[i + 1] = rgba[1];
    px[i + 2] = rgba[2];
    px[i + 3] = 255;
    return;
  }
  px[i] = Math.round(px[i] * (1 - alpha) + rgba[0] * alpha);
  px[i + 1] = Math.round(px[i + 1] * (1 - alpha) + rgba[1] * alpha);
  px[i + 2] = Math.round(px[i + 2] * (1 - alpha) + rgba[2] * alpha);
  px[i + 3] = 255;
}

/** Anti-aliased rounded rectangle coverage at a pixel. */
function roundedCoverage(x, y, rx, ry, rw, rh, r) {
  const cx = Math.min(Math.max(x, rx + r), rx + rw - r);
  const cy = Math.min(Math.max(y, ry + r), ry + rh - r);
  const dx = x - cx;
  const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (x < rx - 1 || x > rx + rw + 1 || y < ry - 1 || y > ry + rh + 1) return 0;
  return Math.min(1, Math.max(0, r + 0.5 - d));
}

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const s = (v) => Math.round(v * size);

  // page background (rounded so maskable icons look right on every launcher)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedCoverage(x + 0.5, y + 0.5, 0, 0, size, size, s(0.19));
      if (a > 0) put(px, size, x, y, COLORS.bg, a);
    }
  }

  // board plate
  const plate = { x: s(0.12), y: s(0.12), w: s(0.76), h: s(0.76), r: s(0.1) };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = roundedCoverage(x + 0.5, y + 0.5, plate.x, plate.y, plate.w, plate.h, plate.r);
      if (a > 0) put(px, size, x, y, COLORS.board, a);
    }
  }

  // four colour bases
  const pad = s(0.055);
  const cell = (plate.w - pad * 3) / 2;
  const quads = [
    [COLORS.red, plate.x + pad, plate.y + pad],
    [COLORS.green, plate.x + pad * 2 + cell, plate.y + pad],
    [COLORS.blue, plate.x + pad, plate.y + pad * 2 + cell],
    [COLORS.yellow, plate.x + pad * 2 + cell, plate.y + pad * 2 + cell],
  ];
  for (const [color, qx, qy] of quads) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = roundedCoverage(x + 0.5, y + 0.5, qx, qy, cell, cell, s(0.035));
        if (a > 0) put(px, size, x, y, color, a);
        // inner pip
        const b = roundedCoverage(
          x + 0.5,
          y + 0.5,
          qx + cell * 0.3,
          qy + cell * 0.3,
          cell * 0.4,
          cell * 0.4,
          cell * 0.2
        );
        if (b > 0) put(px, size, x, y, COLORS.board, b * 0.92);
      }
    }
  }

  // centre die-ish badge
  const c = size / 2;
  const rBadge = s(0.115);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const a = Math.min(1, Math.max(0, rBadge + 0.5 - d));
      if (a > 0) put(px, size, x, y, COLORS.frame, a);
      const inner = Math.min(1, Math.max(0, rBadge * 0.78 + 0.5 - d));
      if (inner > 0) put(px, size, x, y, COLORS.board, inner);
    }
  }
  // three pips on the badge (a "3" face reads at 16px)
  for (const [ox, oy] of [
    [-0.048, -0.048],
    [0, 0],
    [0.048, 0.048],
  ]) {
    const pcx = c + ox * size;
    const pcy = c + oy * size;
    const pr = s(0.016);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - pcx, y + 0.5 - pcy);
        const a = Math.min(1, Math.max(0, pr + 0.5 - d));
        if (a > 0) put(px, size, x, y, COLORS.frame, a);
      }
    }
  }

  return encodePng(size, size, px);
}

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const file = join(OUT, 'icon-' + size + '.png');
  const buf = drawIcon(size);
  writeFileSync(file, buf);
  console.log('wrote', file, buf.length + ' bytes');
}
