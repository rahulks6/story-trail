'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test } = require('node:test');
const { checkPaths, readElfLoadSegments } = require('./elf-alignment.cjs');

/** Minimal little-endian ELF64 shared object with the given machine and PT_LOAD alignments. */
function elf64(machine, aligns) {
  const phoff = 64, phentsize = 56;
  const buf = Buffer.alloc(phoff + phentsize * aligns.length);
  buf.writeUInt32BE(0x7f454c46, 0);
  buf[4] = 2; buf[5] = 1; buf[6] = 1;
  buf.writeUInt16LE(3, 16); // ET_DYN
  buf.writeUInt16LE(machine, 18);
  buf.writeBigUInt64LE(BigInt(phoff), 32);
  buf.writeUInt16LE(phentsize, 54);
  buf.writeUInt16LE(aligns.length, 56);
  aligns.forEach((align, i) => {
    const o = phoff + i * phentsize;
    buf.writeUInt32LE(1, o); // PT_LOAD
    buf.writeBigUInt64LE(BigInt(align), o + 48);
  });
  return buf;
}

/** Minimal zip writer (stored or deflated) with optional per-entry padding before the local header. */
function zip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data, deflate = false, padBefore = 0 } of entries) {
    if (padBefore) { locals.push(Buffer.alloc(padBefore)); offset += padBefore; }
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

function tmp(name, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'katkee-elf-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

test('reads PT_LOAD alignment and the ABI from e_machine', () => {
  const parsed = readElfLoadSegments(elf64(183, [16384, 65536]));
  assert.equal(parsed.abi, 'arm64-v8a');
  assert.deepEqual(parsed.loads.map((l) => l.align), [16384, 65536]);
});

test('passes 16 KB aligned 64-bit libraries inside an AAB', () => {
  const file = tmp('ok.aab', zip([
    { name: 'base/lib/arm64-v8a/libok.so', data: elf64(183, [16384, 16384]), deflate: true },
    { name: 'base/lib/x86_64/libok.so', data: elf64(62, [16384]), deflate: true },
  ]));
  const report = checkPaths([file]);
  assert.equal(report.librariesChecked, 2);
  assert.equal(report.passed, true);
});

test('fails a 4 KB aligned arm64 library even when its directory name lies about the ABI', () => {
  const file = tmp('bad.aab', zip([{ name: 'base/lib/armeabi-v7a/libbad.so', data: elf64(183, [16384, 4096]), deflate: true }]));
  const report = checkPaths([file]);
  assert.equal(report.passed, false);
  assert.equal(report.failures.length, 1);
  assert.match(report.failures[0].problems[0], /p_align=4096/);
});

test('32-bit libraries are informational and never fail the gate', () => {
  const file = tmp('mixed.aab', zip([
    { name: 'base/lib/armeabi-v7a/libold.so', data: elf64(40, [4096]) },
    { name: 'base/lib/arm64-v8a/libok.so', data: elf64(183, [16384]) },
  ]));
  const report = checkPaths([file]);
  assert.equal(report.passed, true);
  assert.equal(report.results.find((r) => r.abi === 'armeabi-v7a').checked, false);
});

test('an APK with an uncompressed library at an unaligned zip offset fails', () => {
  const file = tmp('unaligned.apk', zip([{ name: 'lib/arm64-v8a/libok.so', data: elf64(183, [16384]) }]));
  const report = checkPaths([file]);
  assert.equal(report.passed, false);
  assert.match(report.failures[0].problems.join(' '), /zip offset/);
});

test('an APK whose stored library starts on a 16 KB boundary passes', () => {
  const name = 'lib/arm64-v8a/libok.so';
  const pad = 16384 - (30 + Buffer.byteLength(name));
  const file = tmp('aligned.apk', zip([{ name, data: elf64(183, [16384]), padBefore: pad }]));
  const report = checkPaths([file]);
  assert.equal(report.passed, true);
});

test('an archive without any 64-bit library cannot pass', () => {
  const file = tmp('empty.apk', zip([{ name: 'classes.dex', data: Buffer.from('dex') }]));
  assert.equal(checkPaths([file]).passed, false);
});
