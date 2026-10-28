import { describe, it, expect } from 'vitest';
import { parseAppHash, editHash, rangeLink, fileLink } from '../src/lib/links.js';
import { parseRange } from '../src/core/cell.js';

describe('app addresses', () => {
  it('falls back to home for malformed percent escapes instead of breaking routing', () => {
    for (const value of ['%', '%GG', '%E0%A4%A']) {
      expect(parseAppHash(`#/edit/${value}`)).toEqual({ route: 'home' });
      expect(parseAppHash(`#/template/${value}`)).toEqual({ route: 'home' });
    }
    const path = 'Spreadsheets/100% — café.xlsx';
    expect(parseAppHash(editHash(path))).toMatchObject({ route: 'edit', path });
  });

  it('parses every route, with an optional range on edit', () => {
    // Opening the app, with no hash or at its root, lands in a new sheet; the list has its own address.
    expect(parseAppHash('')).toEqual({ route: 'new' });
    expect(parseAppHash('#/')).toEqual({ route: 'new' });
    expect(parseAppHash('#/home')).toEqual({ route: 'home' });
    expect(parseAppHash('#/new')).toEqual({ route: 'new' });
    expect(parseAppHash('#/sample')).toEqual({ route: 'sample' });
    expect(parseAppHash('#/template/loan%20calc')).toEqual({ route: 'template', id: 'loan calc' });
    expect(parseAppHash('#/edit/Spreadsheets%2FBudget.xlsx')).toEqual({ route: 'edit', path: 'Spreadsheets/Budget.xlsx', range: null });
    expect(parseAppHash("#/edit/Spreadsheets%2FBudget.xlsx?range='Q1%20Data'!B4%3AC9")).toEqual({ route: 'edit', path: 'Spreadsheets/Budget.xlsx', range: "'Q1 Data'!B4:C9" });
    expect(parseAppHash('#edit/Spreadsheets%2FA.xlsx?range=Sheet1!A1&x=1').range).toBe('Sheet1!A1');
  });

  it('builds hashes and full links that parse back', () => {
    expect(editHash('Spreadsheets/Budget.xlsx')).toBe('#/edit/Spreadsheets%2FBudget.xlsx');
    const url = rangeLink({ origin: 'https://sheets.example', pathname: '/' }, 'Spreadsheets/Budget.xlsx', 'Q1 Data', parseRange('B4:C9'));
    expect(url).toBe("https://sheets.example/#/edit/Spreadsheets%2FBudget.xlsx?range='Q1%20Data'!B4%3AC9");
    const parsed = parseAppHash(url.slice(url.indexOf('#')));
    expect(parsed).toEqual({ route: 'edit', path: 'Spreadsheets/Budget.xlsx', range: "'Q1 Data'!B4:C9" });
    expect(rangeLink({ origin: 'https://s.example', pathname: '/app/' }, 'Spreadsheets/A.xlsx', 'Sheet1', parseRange('A1:A1'))).toMatch(/^https:\/\/s\.example\/app\/#\/edit\/Spreadsheets%2FA\.xlsx\?range=Sheet1!A1/);
  });

  it('points links copied from the desktop app at the published site', () => {
    const here = { origin: 'http://localhost:47653', pathname: '/index.html' };
    expect(fileLink(here, 'uid-1')).toBe('https://spreadsheet.puter.com/#/file/uid-1');
    expect(rangeLink(here, 'Spreadsheets/Budget.xlsx', 'Sheet1', parseRange('A1:A1'))).toBe('https://spreadsheet.puter.com/#/edit/Spreadsheets%2FBudget.xlsx?range=Sheet1!A1');
    expect(fileLink({ origin: 'http://127.0.0.1:47653', pathname: '/' }, 'uid-1')).toBe('https://spreadsheet.puter.com/#/file/uid-1');
    // The dev server's own name stays, so a link copied there still opens that server.
    expect(fileLink({ origin: 'http://spreadsheet.puter.localhost:5173', pathname: '/' }, 'uid-1')).toBe('http://spreadsheet.puter.localhost:5173/#/file/uid-1');
  });
});
