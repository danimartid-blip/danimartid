// Genera los PNG del ícono desde los SVG. Android (y muchos launchers) ignoran
// o renderizan mal los SVG como ícono de escritorio — hace falta mapa de bits.
import sharp from "sharp";
import fs from "fs";

const anySvg = fs.readFileSync("icon.svg");
const maskableSvg = fs.readFileSync("icon-maskable.svg");

const jobs = [
  { src: anySvg, size: 512, out: "icons/icon-512.png" },
  { src: anySvg, size: 192, out: "icons/icon-192.png" },
  { src: anySvg, size: 180, out: "icons/apple-touch-icon.png" },
  { src: anySvg, size: 32, out: "icons/favicon-32.png" },
  { src: maskableSvg, size: 512, out: "icons/icon-maskable-512.png" },
  { src: maskableSvg, size: 192, out: "icons/icon-maskable-192.png" },
];

fs.mkdirSync("icons", { recursive: true });

for (const job of jobs) {
  await sharp(job.src, { density: 384 }).resize(job.size, job.size).png().toFile(job.out);
  console.log(`✓ ${job.out} (${job.size}x${job.size})`);
}
console.log("\nListo.");
