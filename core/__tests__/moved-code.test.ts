/**
 * @vitest-environment jsdom
 */

import { expect, test } from 'vite-plus/test';
import { applyMovedLineAttributes, detectMovedLines } from '../lib/moved-code.ts';
import type { ChangedFile } from '../types.ts';

const file = (path: string, patch: string): ChangedFile => ({
  fingerprint: path,
  path,
  sections: [{ binary: false, id: path, kind: 'commit', patch }],
  status: 'modified',
});

test('detects an indentation-only move across files', () => {
  const marks = detectMovedLines([
    file(
      'old.ts',
      '@@ -10,4 +10,0 @@\n-export function value() {\n-  const result = 1;\n-  return result;\n-}\n',
    ),
    file(
      'new.ts',
      '@@ -20,0 +20,4 @@\n+  export function value() {\n+    const result = 1;\n+    return result;\n+  }\n',
    ),
  ]);

  expect(marks).toEqual([
    { lineNumber: 10, sectionId: 'old.ts', side: 'deletions' },
    { lineNumber: 11, sectionId: 'old.ts', side: 'deletions' },
    { lineNumber: 12, sectionId: 'old.ts', side: 'deletions' },
    { lineNumber: 13, sectionId: 'old.ts', side: 'deletions' },
    { lineNumber: 20, sectionId: 'new.ts', side: 'additions' },
    { lineNumber: 21, sectionId: 'new.ts', side: 'additions' },
    { lineNumber: 22, sectionId: 'new.ts', side: 'additions' },
    { lineNumber: 23, sectionId: 'new.ts', side: 'additions' },
  ]);
});

test('leaves an adapted signature in normal addition and deletion colors', () => {
  const marks = detectMovedLines([
    file(
      'service.ts',
      '@@ -4,4 +40,4 @@\n-export function load(input: OldInput) {\n-  const value = parse(input);\n-  return value.result;\n-}\n+export function load(context: Context, input: NewInput) {\n+    const value = parse(input);\n+    return value.result;\n+  }\n',
    ),
  ]);

  expect(marks.map(({ lineNumber, side }) => `${side}:${lineNumber}`)).toEqual([
    'deletions:5',
    'deletions:6',
    'deletions:7',
    'additions:41',
    'additions:42',
    'additions:43',
  ]);
});

test('does not classify short boilerplate as moved code', () => {
  const marks = detectMovedLines([
    file('small.ts', '@@ -1,2 +20,2 @@\n-  return value;\n-}\n+    return value;\n+  }\n'),
  ]);

  expect(marks).toEqual([]);
});

test('keeps blank lines and repeated bridge declarations inside a move', () => {
  const marks = detectMovedLines([
    file(
      'lib.rs',
      '@@ -48,5 +48,0 @@\n-    unsafe extern "C++" {\n-        include!("kj-rs/promise.h");\n-\n-        // Match this declaration.\n-        type OwnPromiseNode;\n',
    ),
    file(
      'ffi.rs',
      '@@ -14,0 +14,5 @@\n+    unsafe extern "C++" {\n+        include!("kj-rs/promise.h");\n+\n+        // Match this declaration.\n+        type OwnPromiseNode;\n',
    ),
  ]);

  expect(marks).toHaveLength(10);
  expect(marks).toContainEqual({
    lineNumber: 50,
    sectionId: 'lib.rs',
    side: 'deletions',
  });
  expect(marks).toContainEqual({
    lineNumber: 16,
    sectionId: 'ffi.rs',
    side: 'additions',
  });
});

test('tags moved content and gutter rows without changing adaptation lines', () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div data-line="5" data-line-type="change-deletion"></div>
    <div data-column-number="5" data-line-type="change-deletion"></div>
    <div data-line="6" data-line-type="change-deletion"></div>
  `;

  applyMovedLineAttributes(root, [{ lineNumber: 5, sectionId: 'section', side: 'deletions' }]);

  expect(root.querySelectorAll('[data-codiff-moved]')).toHaveLength(2);
  expect(root.querySelector('[data-line="6"]')?.hasAttribute('data-codiff-moved')).toBe(false);
});
