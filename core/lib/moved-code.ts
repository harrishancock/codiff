import type { ChangedFile } from '../types.ts';

export type MovedLine = {
  lineNumber: number;
  sectionId: string;
  side: 'additions' | 'deletions';
};

export type MovedCodePalette = 'off' | 'slate';

type ChangedLine = MovedLine & {
  content: string;
  filePath: string;
  normalized: string;
};

type ChangedRun = {
  filePath: string;
  lines: ReadonlyArray<ChangedLine>;
  side: MovedLine['side'];
};

type Match = {
  addition: ChangedRun;
  additionOffset: number;
  characterCount: number;
  deletion: ChangedRun;
  deletionOffset: number;
  length: number;
};

const minimumMovedLineCount = 3;
const minimumMovedCharacterCount = 24;

const normalizeLine = (line: string) => line.trim();

const parseChangedRuns = (files: ReadonlyArray<ChangedFile>) => {
  const runs: Array<ChangedRun> = [];

  for (const file of files) {
    for (const section of file.sections) {
      let oldLineNumber = 0;
      let newLineNumber = 0;
      let currentRun: Array<ChangedLine> = [];
      let currentSide: MovedLine['side'] | null = null;
      const flush = () => {
        if (currentSide && currentRun.length > 0) {
          runs.push({ filePath: file.path, lines: currentRun, side: currentSide });
        }
        currentRun = [];
        currentSide = null;
      };

      for (const patchLine of section.patch.split('\n')) {
        const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(patchLine);
        if (hunk) {
          flush();
          oldLineNumber = Number(hunk[1]);
          newLineNumber = Number(hunk[2]);
          continue;
        }
        if (oldLineNumber === 0 && newLineNumber === 0) {
          continue;
        }

        const prefix = patchLine[0];
        const side =
          prefix === '-' ? ('deletions' as const) : prefix === '+' ? ('additions' as const) : null;
        if (side) {
          if (currentSide !== side) {
            flush();
            currentSide = side;
          }
          const content = patchLine.slice(1);
          currentRun.push({
            content,
            filePath: file.path,
            lineNumber: side === 'deletions' ? oldLineNumber : newLineNumber,
            normalized: normalizeLine(content),
            sectionId: section.id,
            side,
          });
        } else {
          flush();
        }

        if (prefix !== '+') {
          oldLineNumber += 1;
        }
        if (prefix !== '-') {
          newLineNumber += 1;
        }
      }
      flush();
    }
  }

  return runs;
};

const movedFarEnough = (deletion: ChangedLine, addition: ChangedLine, length: number) =>
  deletion.filePath !== addition.filePath ||
  Math.abs(deletion.lineNumber - addition.lineNumber) >= length * 2;

const findMatches = (deletion: ChangedRun, addition: ChangedRun) => {
  const matches: Array<Match> = [];
  const lengths = Array.from({ length: addition.lines.length + 1 }, () => 0);

  for (let deletionIndex = 0; deletionIndex < deletion.lines.length; deletionIndex += 1) {
    for (let additionIndex = addition.lines.length - 1; additionIndex >= 0; additionIndex -= 1) {
      const deletionLine = deletion.lines[deletionIndex];
      const additionLine = addition.lines[additionIndex];
      lengths[additionIndex + 1] =
        deletionLine.normalized === additionLine.normalized ? lengths[additionIndex] + 1 : 0;
      const length = lengths[additionIndex + 1];
      if (length < minimumMovedLineCount) {
        continue;
      }
      const deletionOffset = deletionIndex - length + 1;
      const additionOffset = additionIndex - length + 1;
      const characterCount = deletion.lines
        .slice(deletionOffset, deletionIndex + 1)
        .reduce((count, line) => count + line.normalized.length, 0);
      if (
        characterCount >= minimumMovedCharacterCount &&
        movedFarEnough(deletion.lines[deletionOffset], addition.lines[additionOffset], length)
      ) {
        matches.push({
          addition,
          additionOffset,
          characterCount,
          deletion,
          deletionOffset,
          length,
        });
      }
    }
  }

  return matches;
};

const lineKey = ({ lineNumber, sectionId, side }: MovedLine) =>
  JSON.stringify([sectionId, side, lineNumber]);

export const applyMovedLineAttributes = (root: ParentNode, lines: ReadonlyArray<MovedLine>) => {
  for (const element of root.querySelectorAll('[data-codiff-moved]')) {
    element.removeAttribute('data-codiff-moved');
  }
  for (const element of root.querySelectorAll('[data-codiff-moved-watermark]')) {
    element.removeAttribute('data-codiff-moved-watermark');
  }
  for (const line of lines) {
    const lineType = line.side === 'deletions' ? 'change-deletion' : 'change-addition';
    const selector = `[data-line-type="${lineType}"]:is([data-line="${line.lineNumber}"], [data-column-number="${line.lineNumber}"])`;
    for (const element of root.querySelectorAll(selector)) {
      element.setAttribute('data-codiff-moved', '');
    }
  }

  const runs: Array<Array<MovedLine>> = [];
  for (const line of lines) {
    const run = runs.at(-1);
    const previous = run?.at(-1);
    if (
      run &&
      previous &&
      previous.sectionId === line.sectionId &&
      previous.side === line.side &&
      previous.lineNumber + 1 === line.lineNumber
    ) {
      run.push(line);
    } else {
      runs.push([line]);
    }
  }
  for (const run of runs) {
    for (let offset = 0; offset < run.length; offset += 10) {
      const band = run.slice(offset, offset + 10);
      const middle = band[Math.floor(band.length / 2)];
      const lineType = middle.side === 'deletions' ? 'change-deletion' : 'change-addition';
      root
        .querySelector(`[data-line-type="${lineType}"][data-line="${middle.lineNumber}"]`)
        ?.setAttribute('data-codiff-moved-watermark', middle.side);
    }
  }
};

export const detectMovedLines = (files: ReadonlyArray<ChangedFile>): ReadonlyArray<MovedLine> => {
  const runs = parseChangedRuns(files);
  const deletions = runs.filter((run) => run.side === 'deletions');
  const additions = runs.filter((run) => run.side === 'additions');
  const matches = deletions
    .flatMap((deletion) => additions.flatMap((addition) => findMatches(deletion, addition)))
    .sort(
      (left, right) => right.length - left.length || right.characterCount - left.characterCount,
    );
  const used = new Map<string, MovedLine>();

  for (const match of matches) {
    const lines = [
      ...match.deletion.lines.slice(match.deletionOffset, match.deletionOffset + match.length),
      ...match.addition.lines.slice(match.additionOffset, match.additionOffset + match.length),
    ];
    if (lines.some((line) => used.has(lineKey(line)))) {
      continue;
    }
    for (const line of lines) {
      used.set(lineKey(line), line);
    }
  }

  const sectionOrder = new Map(
    files.flatMap((file) => file.sections).map((section, index) => [section.id, index]),
  );
  return [...used.values()]
    .map(({ lineNumber, sectionId, side }) => ({ lineNumber, sectionId, side }))
    .sort(
      (left, right) =>
        (sectionOrder.get(left.sectionId) ?? 0) - (sectionOrder.get(right.sectionId) ?? 0) ||
        (left.side === right.side ? 0 : left.side === 'deletions' ? -1 : 1) ||
        left.lineNumber - right.lineNumber,
    );
};
