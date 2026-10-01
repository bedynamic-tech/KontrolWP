// Packages plugin/kontrolwp-connect as public/downloads/kontrolwp-connect-<version>.zip so
// the dashboard can offer it for download. No dependencies: a zip is a list
// of deflated files followed by a central directory.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "plugin", "kontrolwp-connect");
// The version from the plugin header; tests/plugin-lint.test.mjs keeps it
// equal to KONTROLWP_CONNECT_VERSION, which names the same file for the dashboard.
const version = /^\s*\*\s*Version:\s*(\S+)/m.exec(readFileSync(join(source, "kontrolwp-connect.php"), "utf8"))?.[1];
if (!version) throw new Error("No Version: line in plugin/kontrolwp-connect/kontrolwp-connect.php");
const downloads = join(root, "public", "downloads");
const output = join(downloads, `kontrolwp-connect-${version}.zip`);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function walk(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
}

export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    // Fixed timestamp (1980-01-01) keeps the archive reproducible.
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = walk(source).map((path) => ({
    // WordPress expects the plugin folder at the top of the archive. It keeps
    // one name across versions: WordPress knows a plugin by its folder, so a
    // versioned folder would install each update as a separate plugin.
    name: ["kontrolwp-connect", ...relative(source, path).split(sep)].join("/"),
    data: readFileSync(path),
  }));
  mkdirSync(dirname(output), { recursive: true });
  // Only the current version is served.
  for (const name of readdirSync(downloads)) {
    if (/^kontrolwp-connect.*\.zip$/.test(name)) rmSync(join(downloads, name));
  }
  writeFileSync(output, buildZip(files));
  console.log(`Built ${relative(root, output)} (${files.length} files)`);
}
