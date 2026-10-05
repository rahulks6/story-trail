'use strict';
/**
 * 16 KB page-size compatibility check for Android native libraries.
 *
 * Usage: node verification/elf-alignment.cjs <file.apk|file.aab|file.aar|file.so|dir> [...more] [--json out.json]
 *
 * For every arm64-v8a and x86_64 shared library found (inside zip archives too), every
 * PT_LOAD program header must have p_align >= 16384. Google Play requires this for apps
 * targeting Android 15+ on 16 KB devices. For APKs it also checks that each stored .so
 * starts at a 16 KB-aligned offset in the zip (what `zipalign -P 16` enforces).
 * 32-bit ABIs (armeabi-v7a, x86) are reported but never fail the check.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const PAGE_16K = 16384;
const CHECKED_ABIS = new Set(['arm64-v8a', 'x86_64']);
// ELF e_machine -> Android ABI. Authoritative, unlike directory names (jni/, lib/, prefab/android.*, NDK sysroot triples).
const MACHINE_ABI = { 183: 'arm64-v8a', 62: 'x86_64', 40: 'armeabi-v7a', 3: 'x86' };

/** Returns {elfClass, abi, loads:[{offset, vaddr, align}]} or throws on non-ELF input. */
function readElfLoadSegments(buf) {
  if (buf.length < 52 || buf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
  const elfClass = buf[4]; // 1 = 32-bit, 2 = 64-bit
  const little = buf[5] === 1;
  const u16 = (o) => (little ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = (o) => Number(little ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o));
  const abi = MACHINE_ABI[u16(18)] ?? `machine-${u16(18)}`;
  const loads = [];
  if (elfClass === 2) {
    const phoff = u64(32), phentsize = u16(54), phnum = u16(56);
    for (let i = 0; i < phnum; i++) {
      const o = phoff + i * phentsize;
      if (o + 56 > buf.length) throw new Error('truncated program header table');
      if (u32(o) === 1) loads.push({ offset: u64(o + 8), vaddr: u64(o + 16), align: u64(o + 48) });
    }
  } else if (elfClass === 1) {
    const phoff = u32(28), phentsize = u16(42), phnum = u16(44);
    for (let i = 0; i < phnum; i++) {
      const o = phoff + i * phentsize;
      if (o + 32 > buf.length) throw new Error('truncated program header table');
      if (u32(o) === 1) loads.push({ offset: u32(o + 4), vaddr: u32(o + 8), align: u32(o + 28) });
    }
  } else {
    throw new Error('unknown ELF class');
  }
  return { elfClass, abi, loads };
}

/** Minimal zip reader: central directory -> entries with data offset and lazily inflated bytes. */
function readZipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff || count === 0xffff) {
    // ZIP64 end of central directory locator.
    const loc = eocd - 20;
    if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 locator missing');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    let compressedSize = buf.readUInt32LE(p + 20);
    let localOffset = buf.readUInt32LE(p + 42);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    // ZIP64 extra field carries real sizes/offsets when the 32-bit fields are saturated.
    let e = p + 46 + nameLen;
    const end = e + extraLen;
    let uncompressedSize = buf.readUInt32LE(p + 24);
    while (e + 4 <= end) {
      const id = buf.readUInt16LE(e), size = buf.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(q)); }
      }
      e += 4 + size;
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26), lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    entries.push({
      name, method, dataOffset,
      data: () => {
        const raw = buf.subarray(dataOffset, dataOffset + compressedSize);
        if (method === 0) return raw;
        if (method === 8) return zlib.inflateRawSync(raw);
        throw new Error(`unsupported zip method ${method} for ${name}`);
      },
    });
    p = end + commentLen;
  }
  return entries;
}

function checkElf(label, bytes, zipInfo) {
  const result = { file: label, abi: 'unknown', checked: true, ok: true, problems: [] };
  try {
    const { abi, loads } = readElfLoadSegments(bytes);
    result.abi = abi;
    result.checked = CHECKED_ABIS.has(abi);
    result.minLoadAlign = loads.length ? Math.min(...loads.map((l) => l.align)) : null;
    for (const l of loads) {
      if (l.align < PAGE_16K) result.problems.push(`PT_LOAD p_align=${l.align} (< ${PAGE_16K})`);
    }
    if (zipInfo && zipInfo.isApk && zipInfo.method === 0 && zipInfo.dataOffset % PAGE_16K !== 0) {
      result.problems.push(`stored at zip offset ${zipInfo.dataOffset}, not 16 KB aligned (run zipalign -P 16)`);
    }
  } catch (error) {
    result.problems.push(`unreadable ELF: ${error.message}`);
  }
  if (result.checked && result.problems.length) result.ok = false;
  return result;
}

function scan(target, results) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) scan(path.join(target, entry), results);
    return;
  }
  const lower = target.toLowerCase();
  if (lower.endsWith('.so')) {
    results.push(checkElf(target, fs.readFileSync(target)));
    return;
  }
  if (!/\.(apk|aab|aar|zip|jar)$/.test(lower)) return;
  const buf = fs.readFileSync(target);
  const isApk = lower.endsWith('.apk');
  for (const entry of readZipEntries(buf)) {
    if (entry.name.endsWith('.so')) {
      results.push(checkElf(`${path.basename(target)}!${entry.name}`, entry.data(),
        { isApk, method: entry.method, dataOffset: entry.dataOffset }));
    } else if (/\.(aar|apk)$/.test(entry.name)) {
      // Nested archives (e.g. universal APK inside an .apks set).
      const nested = path.join(require('node:os').tmpdir(), `katkee-elf-${process.pid}-${path.basename(entry.name)}`);
      fs.writeFileSync(nested, entry.data());
      try { scan(nested, results); } finally { fs.rmSync(nested, { force: true }); }
    }
  }
}

function checkPaths(paths) {
  const results = [];
  for (const p of paths) scan(p, results);
  const checked = results.filter((r) => r.checked);
  return {
    generatedAt: new Date().toISOString(),
    inputs: paths,
    librariesFound: results.length,
    librariesChecked: checked.length,
    failures: checked.filter((r) => !r.ok),
    results,
    passed: checked.length > 0 && checked.every((r) => r.ok),
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const jsonIndex = args.indexOf('--json');
  const jsonOut = jsonIndex >= 0 ? args.splice(jsonIndex, 2)[1] : null;
  if (!args.length) {
    console.error('Usage: node verification/elf-alignment.cjs <apk|aab|aar|so|dir>... [--json out.json]');
    process.exit(2);
  }
  const report = checkPaths(args);
  for (const r of report.results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} [${r.abi}${r.checked ? '' : ', informational'}] ${r.file}${r.problems.length ? ' — ' + r.problems.join('; ') : ''}`);
  }
  console.log(`\n${report.librariesChecked} 64-bit libraries checked, ${report.failures.length} failing. ${report.passed ? 'PASS' : 'FAIL'}`);
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}

module.exports = { readElfLoadSegments, readZipEntries, checkPaths, PAGE_16K };
