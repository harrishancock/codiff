/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { ReviewDraftRecoveryView } from '../app/components/ReviewDraftRecoveryView.tsx';
import type { ClassifiedReviewDraft } from '../lib/review-drafts.ts';
import { renderReact } from './helpers/react.tsx';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

const draft: ClassifiedReviewDraft = {
  comment: {
    body: 'Keep this safety check.',
    filePath: 'src/check.ts',
    id: 'draft-1',
    lineNumber: 12,
    sectionId: 'old-section',
    side: 'additions',
  },
  disposition: 'legacy',
  id: 'draft-1',
  reason: 'Draft predates review scopes.',
  scope: { key: 'legacy', label: 'Legacy / Recovered', type: 'legacy' },
  scopeKey: 'legacy',
  source: { ref: 'abcdef123456', type: 'commit' },
  sourceKey: 'commit:abcdef123456',
  sourceSnapshot: null,
};

test('shows durable comments without resolving their historical diff', async () => {
  await using view = await renderReact(
    <ReviewDraftRecoveryView drafts={[draft]} scopeLabel="Legacy / Recovered" />,
  );

  expect(view.container.textContent).toContain('Legacy / Recovered');
  expect(view.container.textContent).toContain('abcdef1');
  expect(view.container.textContent).toContain('src/check.ts');
  expect(view.container.textContent).toContain('New line 12');
  expect(view.container.textContent).toContain('Draft predates review scopes.');
  expect(view.container.textContent).toContain('Keep this safety check.');

  const copy = [...view.container.querySelectorAll('button')].find(
    ({ textContent }) => textContent === 'Copy Comment',
  );
  await act(() => copy?.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    expect.stringContaining('Keep this safety check.'),
  );
});

test('copies every draft in the selected recovery scope', async () => {
  await using view = await renderReact(
    <ReviewDraftRecoveryView drafts={[draft]} scopeLabel="Legacy / Recovered" />,
  );

  const copy = [...view.container.querySelectorAll('button')].find(
    ({ textContent }) => textContent === 'Copy Scope Drafts (1)',
  );
  await act(() => copy?.click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    expect.stringContaining('"scopeKey": "legacy"'),
  );
});

test('clears the selected scope only after exact-count confirmation', async () => {
  const clearScope = vi.fn(() => Promise.resolve());
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  await using view = await renderReact(
    <ReviewDraftRecoveryView
      drafts={[draft]}
      onClearScope={clearScope}
      scopeLabel="Legacy / Recovered"
    />,
  );

  const clear = [...view.container.querySelectorAll('button')].find(
    ({ textContent }) => textContent === 'Clear Scope Drafts…',
  );
  await act(() => clear?.click());
  expect(window.confirm).toHaveBeenCalledWith(
    'Clear 1 staged review comment from Legacy / Recovered?',
  );
  expect(clearScope).toHaveBeenCalledOnce();
});
