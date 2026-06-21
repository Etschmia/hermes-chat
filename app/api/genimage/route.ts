import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// Serves images that the Hermes agent generated on the server's filesystem.
// Generated images come back in assistant messages as a Markdown image with a
// LOCAL path (e.g. ~/.hermes/cache/images/xai_…jpg), which the browser can't
// load directly — this route reads the file and streams it.
//
// SECURITY: serving files by path is dangerous. We only serve files whose real
// path is inside an allowlisted set of Hermes image dirs AND whose extension is
// an image type — so no path traversal and no leaking config.yaml/auth.json.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

// Where the agent is allowed to have written images. Override with a
// colon-separated HERMES_IMAGE_DIRS if your setup uses other folders.
function allowedDirs(): string[] {
  const env = process.env.HERMES_IMAGE_DIRS;
  if (env) return env.split(':').filter(Boolean);
  const h = os.homedir();
  return [
    path.join(h, '.hermes', 'cache', 'images'),
    path.join(h, '.hermes', 'images'),
    path.join(h, '.hermes', 'image_cache'),
    path.join(h, '.hermes', 'hermes-agent', 'plugins', 'image_gen'),
  ];
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('path');
  if (!raw) return new NextResponse('missing path', { status: 400 });

  // Accept file:// URLs too; normalize to a plain path.
  const requested = raw.startsWith('file://') ? raw.slice('file://'.length) : raw;

  const ext = path.extname(requested).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return new NextResponse('not found', { status: 404 }); // not an image → refuse

  // Resolve real paths so symlinks/.. can't escape the allowlist.
  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }

  const bases = await Promise.all(allowedDirs().map(d => fs.realpath(d).catch(() => null)));
  const inside = bases.some(b => b && (real === b || real.startsWith(b + path.sep)));
  if (!inside) return new NextResponse('not found', { status: 404 }); // 404, not 403 — don't confirm existence

  let data: Buffer;
  try {
    data = await fs.readFile(real);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }

  const download = request.nextUrl.searchParams.get('download') === '1';
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(data.length),
    'Cache-Control': 'private, max-age=86400',
  };
  if (download) {
    // Force "save as" with the original filename.
    headers['Content-Disposition'] = `attachment; filename="${path.basename(real).replace(/"/g, '')}"`;
  }
  return new NextResponse(new Uint8Array(data), { status: 200, headers });
}
