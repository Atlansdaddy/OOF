/**
 * build-opt.js — itch.io optimized build
 *
 * Strategy (zero format-compat risk):
 *   backgrounds/, screens/, wave-cards/, promo/, title/  → JPEG 82q (photographic, no alpha)
 *   sprites (objects/, hats/, character/, bosses/, ui/, powerups/)  → resized PNG
 *   SVG, ZIP, other  → copy verbatim
 *
 * HTML rewriting: only background/screen/wave PNG→JPG paths are updated.
 * Sprite paths keep .png so no JS changes needed.
 *
 * Zip: uses archiver with POSIX forward-slash paths (Linux/itch.io CDN safe).
 */
const sharp    = require('sharp');
const archiver = require('archiver');
const fs       = require('fs');
const path     = require('path');

const ROOT       = __dirname;
const BUILD      = path.join(ROOT, '_opt_build');
const ASSETS_SRC = path.join(ROOT, 'assets');
const ASSETS_DST = path.join(BUILD, 'assets');
const ZIP_OUT    = path.join(ROOT, 'ooa-itchio.zip');

// Max px width by folder (sprites only — photos use JPEG so resize matters less)
const SPRITE_MAX = {
  'bosses':   500,
  'character':400,
  'hats':     300,
  'objects':  300,
  'powerups': 300,
  'ui':       256,
};

// These folders get converted to JPEG (photographic, no transparency)
const JPEG_FOLDERS = new Set(['backgrounds','screens','wave-cards','promo','title']);

function walk(dir, list = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, list);
    else list.push(full);
  }
  return list;
}
function mkdirp(p) { fs.mkdirSync(p, { recursive: true }); }

(async () => {
  if (fs.existsSync(BUILD)) fs.rmSync(BUILD, { recursive: true, force: true });
  mkdirp(ASSETS_DST);

  const files = walk(ASSETS_SRC);
  let optimized = 0, copied = 0, savedTotal = 0;
  const pngToJpg = {};   // 'assets/backgrounds/x.png' → 'assets/backgrounds/x.jpg'

  for (const src of files) {
    const rel    = path.relative(ASSETS_SRC, src);
    const relFwd = rel.replace(/\\/g, '/');
    const ext    = path.extname(src).toLowerCase();
    const folder = relFwd.split('/')[0];
    const srcSize = fs.statSync(src).size;
    const dstDir  = path.join(ASSETS_DST, path.dirname(rel));
    mkdirp(dstDir);

    // ── JPEG conversion (backgrounds + photo assets) ──────────────────────
    if ((ext === '.png' || ext === '.jpg' || ext === '.jpeg') && JPEG_FOLDERS.has(folder)) {
      const baseName = path.basename(rel, ext) + '.jpg';
      const dst = path.join(dstDir, baseName);
      try {
        await sharp(src).jpeg({ quality: 82, mozjpeg: true }).toFile(dst);
        const dstSize = fs.statSync(dst).size;
        savedTotal += Math.max(0, srcSize - dstSize);
        const pct = Math.round((1 - dstSize / srcSize) * 100);
        process.stdout.write(`  ✓ jpg ${relFwd} -${pct}%  \r`);
        if (ext === '.png') pngToJpg['assets/' + relFwd] = 'assets/' + relFwd.replace(/\.png$/i, '.jpg');
        optimized++;
      } catch (e) {
        fs.copyFileSync(src, path.join(dstDir, path.basename(rel)));
        copied++;
        console.log(`  ! fallback copy: ${relFwd} (${e.message})`);
      }
      continue;
    }

    // ── Sprite PNG: resize + compress ─────────────────────────────────────
    if (ext === '.png' && SPRITE_MAX[folder]) {
      const maxW = SPRITE_MAX[folder];
      const dst  = path.join(dstDir, path.basename(rel));
      try {
        await sharp(src)
          .resize({ width: maxW, withoutEnlargement: true })
          .png({ compressionLevel: 9, adaptiveFiltering: true })
          .toFile(dst);
        const dstSize = fs.statSync(dst).size;
        savedTotal += Math.max(0, srcSize - dstSize);
        const pct = Math.round((1 - dstSize / srcSize) * 100);
        process.stdout.write(`  ✓ png ${relFwd} -${pct}%  \r`);
        optimized++;
      } catch (e) {
        fs.copyFileSync(src, dst);
        copied++;
        console.log(`  ! fallback copy: ${relFwd} (${e.message})`);
      }
      continue;
    }

    // ── Everything else (SVG, ZIP, other PNG) — copy verbatim ─────────────
    fs.copyFileSync(src, path.join(dstDir, path.basename(rel)));
    copied++;
  }

  console.log(`\nOptimized: ${optimized}  |  Copied: ${copied}  |  Saved: ${(savedTotal / 1048576).toFixed(1)} MB`);

  // ── Rewrite index.html: only PNG→JPG remaps needed ────────────────────
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  let hits = 0;
  for (const [oldPath, newPath] of Object.entries(pngToJpg)) {
    const esc = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(esc, 'g'), () => { hits++; return newPath; });
  }
  fs.writeFileSync(path.join(BUILD, 'index.html'), html, 'utf8');
  console.log(`HTML: rewrote ${hits} PNG→JPG references`);

  // ── Zip with archiver (POSIX paths, Linux-safe) ────────────────────────
  if (fs.existsSync(ZIP_OUT)) fs.unlinkSync(ZIP_OUT);
  await new Promise((resolve, reject) => {
    const output  = fs.createWriteStream(ZIP_OUT);
    const archive = archiver('zip', { zlib: { level: 6 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.file(path.join(BUILD, 'index.html'), { name: 'index.html' });
    archive.directory(ASSETS_DST, 'assets');
    archive.finalize();
  });

  const origMB = (fs.statSync(path.join(ROOT, 'ooa-build-11.zip')).size / 1048576).toFixed(1);
  const newMB  = (fs.statSync(ZIP_OUT).size / 1048576).toFixed(1);
  const pct    = ((1 - newMB / origMB) * 100).toFixed(0);
  console.log(`\n✓  ooa-itchio.zip  —  ${newMB} MB  (was ${origMB} MB → ${pct}% smaller)`);
  console.log('   Backgrounds: JPEG  |  Sprites: resized PNG  |  Zip: POSIX paths');
})();
