// middleware/upload.js - Multer file upload with a per-field size limit.
// Requirements: FR-1.1, FR-1.2 (max file size). Built in Sprint 2.
// Not attached to any route yet: the upload endpoint is decision D-1, due in Sprint 3.
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

const UPLOAD_DIR = new URL('../uploads/', import.meta.url).pathname;
mkdirSync(UPLOAD_DIR, { recursive: true });

// Save to disk under a random name. We never use the visitor's file name, because it
// could contain tricks like "../../something".
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => cb(null, randomUUID()),
});

// makeUpload(5) -> middleware accepting one file named "file", at most 5 MB.
// Too big -> HTTP 400 with a clear message (not Multer's default 500).
export function makeUpload(maxFileSizeMB) {
  const single = multer({ storage, limits: { fileSize: maxFileSizeMB * 1024 * 1024 } }).single('file');
  return (req, res, next) => {
    single(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `File is too large (max ${maxFileSizeMB} MB)` });
      }
      next(err);
    });
  };
}

export { UPLOAD_DIR };
