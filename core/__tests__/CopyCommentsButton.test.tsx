/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import {
  ClearReviewDraftsButton,
  CopyAllCommentsButton,
  MovedCodePaletteControl,
} from '../app/components/Panels.tsx';
import { renderReact } from './helpers/react.tsx';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

const renderCopyCommentsButton = () =>
  renderReact(
    <CopyAllCommentsButton
      counts={{ allInReview: 5, allRepository: 8, current: 2 }}
      getAllInReviewJSON={() => 'all-in-review'}
      getAllRepositoryJSON={() => 'all-repository'}
      getCurrentJSON={() => 'current'}
    />,
  );

test('copies current review comments from the main action', async () => {
  await using app = await renderCopyCommentsButton();

  const button = app.container.querySelector<HTMLButtonElement>('.copy-comments-button');
  expect(button?.getAttribute('aria-label')).toBe('Copy 2 current review comments as JSON');
  expect(button?.textContent).toBe('Current (2)');
  await act(() => button?.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('current');
});

test('offers broader review and repository copy actions', async () => {
  await using app = await renderCopyCommentsButton();

  const toggle = app.container.querySelector<HTMLButtonElement>('.copy-comments-toggle');
  await act(() => toggle?.click());

  const actions = [
    ...app.container.querySelectorAll<HTMLButtonElement>('.copy-comments-menu button'),
  ];
  expect(actions.map(({ textContent }) => textContent)).toEqual([
    'All in Review (5)',
    'All Repository Drafts (8)',
  ]);
  expect(actions[0]?.title).toContain('current review scope');
  expect(actions[1]?.title).toContain('all known review scopes');

  await act(() => actions[1]?.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('all-repository');
});

test('keeps broader copy actions available when there are no current comments', async () => {
  await using app = await renderReact(
    <CopyAllCommentsButton
      counts={{ allInReview: 3, allRepository: 4, current: 0 }}
      getAllInReviewJSON={() => 'all-in-review'}
      getAllRepositoryJSON={() => 'all-repository'}
      getCurrentJSON={() => 'current'}
    />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('.copy-comments-button');
  const toggle = app.container.querySelector<HTMLButtonElement>('.copy-comments-toggle');
  expect(button?.disabled).toBe(true);
  expect(toggle?.disabled).toBe(false);
});

test('disables all copy actions when there are no drafts', async () => {
  await using app = await renderReact(
    <CopyAllCommentsButton
      counts={{ allInReview: 0, allRepository: 0, current: 0 }}
      getAllInReviewJSON={() => 'all-in-review'}
      getAllRepositoryJSON={() => 'all-repository'}
      getCurrentJSON={() => 'current'}
    />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('.copy-comments-button');
  const toggle = app.container.querySelector<HTMLButtonElement>('.copy-comments-toggle');
  expect(button?.disabled).toBe(true);
  expect(toggle?.disabled).toBe(true);
});

test('confirms contextual clearing with the current review count', async () => {
  const onClear = vi.fn(() => Promise.resolve());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await using app = await renderReact(
    <ClearReviewDraftsButton commentCount={3} onClear={onClear} reviewLabel="feature" />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('.clear-review-drafts-button');
  expect(button?.textContent).toBe('Clear (3)');
  await act(() => button?.click());
  expect(window.confirm).toHaveBeenCalledWith('Clear 3 staged review comments from feature?');
  expect(onClear).toHaveBeenCalledOnce();
});

test('cycles through moved-code palettes including off', async () => {
  const onChange = vi.fn();
  await using app = await renderReact(
    <MovedCodePaletteControl onChange={onChange} value="violet" />,
  );

  const button = app.container.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Moves: Faint');
  await act(() => button?.click());
  expect(onChange).toHaveBeenCalledWith('off');
});
