/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { expect, test, vi } from 'vite-plus/test';
import { BranchPicker } from '../app/components/BranchPicker.tsx';
import { renderReact, waitFor } from './helpers/react.tsx';

test('opens from the current branch and selects a resolved branch review', async () => {
  const onSelect = vi.fn(() => Promise.resolve());
  window.codiff = {
    getLocalBranches: vi.fn(async () => [
      {
        baseRef: 'base-new',
        createdAt: 2000,
        headRef: 'head-new',
        name: 'feature/new',
        refMtime: 2100,
        subject: 'New work',
        updatedAt: 2200,
        upstream: null,
        worktreePath: null,
      },
      {
        baseRef: 'base-old',
        createdAt: 1000,
        headRef: 'head-old',
        name: 'main',
        refMtime: 1100,
        subject: 'Old work',
        updatedAt: 1200,
        upstream: 'origin/main',
        worktreePath: '/repo',
      },
    ]),
  } as unknown as Window['codiff'];

  await using view = await renderReact(<BranchPicker currentBranch="main" onSelect={onSelect} />);
  await act(() =>
    view.container.querySelector<HTMLButtonElement>('.branch-picker-trigger')?.click(),
  );
  await waitFor(() => expect(view.container.textContent).toContain('feature/new'));

  const branches = [...view.container.querySelectorAll<HTMLButtonElement>('.branch-picker-item')];
  expect(branches.map(({ textContent }) => textContent)).toEqual([
    expect.stringContaining('feature/new'),
    expect.stringContaining('main'),
  ]);
  await act(() => branches[0]?.click());
  expect(onSelect).toHaveBeenCalledWith({
    baseRef: 'base-new',
    headRef: 'head-new',
    ref: 'feature/new',
    type: 'branch-diff',
  });
});
