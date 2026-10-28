const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { spreadsheetArg } = require('./open-file.cjs');
const { createDesktopFiles } = require('./desktop-files.cjs');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-open-'));
}

test('picks the spreadsheet Windows passed and skips the program itself', () => {
  const dir = tmp();
  const file = path.join(dir, 'Budget.xlsx');
  fs.writeFileSync(file, 'xlsx');
  const found = spreadsheetArg([process.execPath, path.join(dir, 'notes.txt'), file], dir);
  assert.equal(found, file);
  assert.equal(spreadsheetArg(['Spreadsheet.exe', '--flag'], dir), null);
});

test('reads, saves and renames only the workbook it was given', async () => {
  const dir = tmp();
  const file = path.join(dir, 'Budget.xlsx');
  fs.writeFileSync(file, 'before');
  const other = path.join(dir, 'Other.xlsx');
  fs.writeFileSync(other, 'other');
  const desktop = createDesktopFiles();
  const info = desktop.add(file, { asLaunch: true });
  assert.equal(info.writable, true);
  assert.equal(desktop.launch.token, info.token);

  const server = http.createServer((req, res) => {
    if (!desktop.handle(req, res)) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal(await (await fetch(`${base}/__desktop/file/${info.token}`)).text(), 'before');
    assert.equal((await fetch(`${base}/__desktop/file/${'a'.repeat(32)}`)).status, 404);
    const put = await fetch(`${base}/__desktop/file/${info.token}`, { method: 'PUT', body: 'after' });
    assert.equal(put.status, 204);
    assert.equal(fs.readFileSync(file, 'utf8'), 'after');
    const renamed = await fetch(`${base}/__desktop/rename/${info.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Q1' }),
    });
    assert.equal(renamed.status, 200);
    assert.equal(fs.existsSync(path.join(dir, 'Q1.xlsx')), true);
    const taken = desktop.add(other);
    const clash = await fetch(`${base}/__desktop/rename/${info.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other' }),
    });
    assert.equal(clash.status, 409);
    assert.equal(taken.name, 'Other.xlsx');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
