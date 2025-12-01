import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const TMP_DIR = path.join(process.cwd(), 'tmp');
export function ensureTmp() {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}
export function tmpFilePath() {
  ensureTmp();
  const id = crypto.randomUUID();
  return path.join(TMP_DIR, `${id}.part`);
}
