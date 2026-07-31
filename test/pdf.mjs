import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Everything a PDF says about itself, readable: object dictionaries sit in the
// file as they are, but PDF 1.5 keeps the page tree in a compressed object
// stream, so the streams have to be inflated and searched as well.
export function readPdf(pdf) {
  const buf = fs.readFileSync(pdf);
  let text = buf.toString('latin1');
  for (let i = buf.indexOf('stream'); i >= 0; i = buf.indexOf('stream', i)) {
    let start = i + 6;
    if (buf[start] === 13) start++;
    if (buf[start] === 10) start++;
    const end = buf.indexOf('endstream', start);
    if (end < 0) break;
    try {
      text += zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {}
    i = end + 9;
  }
  return text;
}

export function pageCount(pdf) {
  const counts = [...readPdf(pdf).matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(counts.length > 0, `could not read a page count from ${pdf}`);
  return Math.max(...counts);
}

// The width of the first page, in points. A4 is 595, B5 is 499.
export function pageWidth(pdf) {
  const box = readPdf(pdf).match(/\/MediaBox\s*\[\s*\S+\s+\S+\s+(\S+)/);
  assert.ok(box, `could not read a page size from ${pdf}`);
  return Number(box[1]);
}

// The size of every raster image the PDF embeds, as "23x7" strings.
export function imageSizes(pdf) {
  return [...readPdf(pdf).matchAll(/\/Subtype\s*\/Image\s*\/Width\s+(\d+)\s*\/Height\s+(\d+)/g)].map(
    (m) => `${m[1]}x${m[2]}`
  );
}
