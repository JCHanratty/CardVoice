/**
 * Generate PNG and ICO icons from the SVG logo.
 * Usage: node scripts/generate-icons.js
 * Requires: sharp (install as devDep)
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const svgPath = path.join(__dirname, '..', 'electron', 'icon.svg');
const electronDir = path.join(__dirname, '..', 'electron');
const publicDir = path.join(__dirname, '..', 'frontend', 'public');

/**
 * Create an ICO file from PNG buffers.
 * ICO format: header + directory entries + image data (stored as PNG)
 */
function createIco(pngBuffers) {
  const numImages = pngBuffers.length;

  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);       // reserved
  header.writeUInt16LE(1, 2);       // type: 1 = ICO
  header.writeUInt16LE(numImages, 4); // number of images

  // Each directory entry: 16 bytes
  const dirEntries = [];
  let dataOffset = 6 + (numImages * 16);

  for (const { size, buffer } of pngBuffers) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);   // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1);   // height (0 = 256)
    entry.writeUInt8(0, 2);            // color palette
    entry.writeUInt8(0, 3);            // reserved
    entry.writeUInt16LE(1, 4);         // color planes
    entry.writeUInt16LE(32, 6);        // bits per pixel
    entry.writeUInt32LE(buffer.length, 8);  // image data size
    entry.writeUInt32LE(dataOffset, 12);    // offset to image data
    dirEntries.push(entry);
    dataOffset += buffer.length;
  }

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map(p => p.buffer)]);
}

async function main() {
  fs.mkdirSync(publicDir, { recursive: true });

  const svgBuffer = fs.readFileSync(svgPath);

  // Generate PNGs at multiple sizes
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const pngData = [];

  for (const size of icoSizes) {
    const buffer = await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toBuffer();
    pngData.push({ size, buffer });
    console.log(`  Generated ${size}x${size} PNG`);
  }

  // Generate 512x512 for Electron icon.png
  const icon512 = await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toBuffer();
  console.log(`  Generated 512x512 PNG`);

  // Save icon.png
  fs.writeFileSync(path.join(electronDir, 'icon.png'), icon512);
  console.log(`  Saved electron/icon.png`);

  // Create ICO
  const icoBuffer = createIco(pngData);
  fs.writeFileSync(path.join(electronDir, 'icon.ico'), icoBuffer);
  console.log(`  Saved electron/icon.ico`);

  // Copy as favicon
  fs.copyFileSync(path.join(electronDir, 'icon.ico'), path.join(publicDir, 'favicon.ico'));
  console.log(`  Saved frontend/public/favicon.ico`);

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
