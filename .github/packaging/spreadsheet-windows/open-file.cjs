/**
 * The spreadsheet Windows hands this program when it is the file's opener:
 * `Spreadsheet.exe "C:\Budget.xlsx"`. The executable and any flag on the
 * command line are not files of those kinds, so they are passed over.
 */

const fs = require('fs');
const path = require('path');

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xlsm', '.xls', '.xltx', '.xltm', '.csv', '.tsv', '.ods', '.xlsb', '.fods'];

function isSpreadsheetName(name) {
  const lower = String(name || '').toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** The last spreadsheet path among the arguments, or null. Relative paths are read from `cwd`. */
function spreadsheetArg(argv, cwd = process.cwd()) {
  let found = null;
  for (const arg of argv || []) {
    if (typeof arg !== 'string' || !arg || arg.startsWith('-')) continue;
    let abs;
    try { abs = path.resolve(cwd, arg); } catch { continue; }
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || !isSpreadsheetName(path.basename(abs))) continue;
    found = abs;
  }
  return found;
}

module.exports = { SPREADSHEET_EXTENSIONS, isSpreadsheetName, spreadsheetArg };
