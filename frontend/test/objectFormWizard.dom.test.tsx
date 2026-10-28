/**
 * [UI-20260901-OBJWIZARD] The Object wizard shell.
 *
 * Three things are being defended, each of which has burned this project before:
 *
 *  1. **Panes hide, they do not unmount.** Unmounting drops the DOM state of
 *     every child on the step you walked away from.
 *  2. **Hidden means hidden in BOTH worlds.** The `hidden` attribute (jsdom and
 *     these tests) and Tailwind's `hidden` class (the real browser, which is the
 *     only one that loads CSS). Tests here have gone green while the screen was
 *     blank because only one was checked.
 *  3. **An error on a hidden step is still findable.** The chip goes red and a
 *     failed save lands on the first failing step.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ObjectFormTabs,
  ObjectStepNav,
  firstInvalidStep,
  focusFirstError,
  stepErrorCounts,
} from '../components/object/scope/ObjectFormTabs';

vi.mock('../i18n', () => ({
  useI18n: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${Object.values(vars).join(',')}` : k,
  }),
}));

const STEPS = [
  { id: 'basic', label: 'Details', fields: ['name'], content: <p>step one</p> },
  { id: 'media', label: 'Media', fields: [], content: <p>step two</p> },
  { id: 'access', label: 'Access', fields: ['scope'], content: <p>step three</p> },
];

const renderTabs = (over: Record<string, unknown> = {}) =>
  render(
    <ObjectFormTabs
      steps={STEPS}
      activeIndex={0}
      showAll={false}
      errors={{}}
      onPick={() => {}}
      onToggleShowAll={() => {}}
      {...over}
    />,
  );

describe('field ownership', () => {
  it('counts errors per step, in step order', () => {
    expect(stepErrorCounts(STEPS, { name: 'bad', scope: 'bad' })).toEqual([
      1, 0, 1,
    ]);
  });

  it('finds the FIRST failing step, not any failing step', () => {
    expect(firstInvalidStep(STEPS, { scope: 'bad' })).toBe(2);
    expect(firstInvalidStep(STEPS, { name: 'bad', scope: 'bad' })).toBe(0);
  });

  it('an error no step claims is reported as none — the caller must notice', () => {
    expect(firstInvalidStep(STEPS, { orphan: 'bad' })).toBe(-1);
  });
});

/* [FIX-20260901-STEPFOCUS] Landing on the right step is not enough: the body
   scrolls, so the failing field can be below the fold of the step it is on. */
describe('focusFirstError', () => {
  const withDom = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    return host;
  };

  beforeEach(() => {
    /* jsdom implements neither; without stubs these calls throw and the helper
       would look broken when it is the environment that is missing. */
    Element.prototype.scrollIntoView = vi.fn();
    /* Run the callback synchronously so the assertion does not race paint. */
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('scrolls the first error into view', () => {
    const host = withDom('<p data-testid="a-error">bad</p>');
    focusFirstError(host);
    expect(
      (host.querySelector('[data-testid="a-error"]') as HTMLElement)
        .scrollIntoView,
    ).toHaveBeenCalled();
  });

  it('focuses the input when the error IS the input', () => {
    const host = withDom('<input aria-invalid="true" />');
    focusFirstError(host);
    expect(document.activeElement).toBe(host.querySelector('input'));
  });

  it('does nothing when there is no error to find', () => {
    const host = withDom('<p>all good</p>');
    expect(() => focusFirstError(host)).not.toThrow();
  });

  it('survives a null container rather than throwing mid-save', () => {
    expect(() => focusFirstError(null)).not.toThrow();
  });
});

describe('panes', () => {
  it('renders every step, showing only the active one', () => {
    renderTabs({ activeIndex: 1 });

    expect(screen.getByTestId('object-wizard-pane-basic')).toHaveAttribute(
      'data-step-visible',
      'no',
    );
    expect(screen.getByTestId('object-wizard-pane-media')).toHaveAttribute(
      'data-step-visible',
      'yes',
    );
  });

  /* The whole reason panes are hidden rather than conditionally rendered. */
  it('keeps hidden steps MOUNTED so their children do not lose state', () => {
    renderTabs({ activeIndex: 2 });
    expect(screen.getByText('step one')).toBeInTheDocument();
    expect(screen.getByText('step two')).toBeInTheDocument();
  });

  it('hides in both worlds: the attribute AND the class', () => {
    renderTabs({ activeIndex: 0 });
    const hiddenPane = screen.getByTestId('object-wizard-pane-media');
    expect(hiddenPane).toHaveAttribute('hidden');
    expect(hiddenPane.className).toContain('hidden');
  });

  it('"show all" reveals every step at once', () => {
    renderTabs({ activeIndex: 0, showAll: true });
    for (const id of ['basic', 'media', 'access']) {
      expect(screen.getByTestId(`object-wizard-pane-${id}`)).toHaveAttribute(
        'data-step-visible',
        'yes',
      );
    }
  });
});

describe('the rail', () => {
  it('says which step of how many', () => {
    renderTabs({ activeIndex: 1 });
    expect(screen.getByTestId('object-wizard-position')).toHaveTextContent(
      'broadcast.wizard_step_of:2,3',
    );
  });

  it('counts down the steps left, and names the last one', () => {
    renderTabs({ activeIndex: 0 });
    expect(screen.getByTestId('object-wizard-remaining')).toHaveTextContent(
      'broadcast.wizard_remaining:2',
    );

    renderTabs({ activeIndex: 2 });
    expect(screen.getAllByTestId('object-wizard-remaining')[1]).toHaveTextContent(
      'broadcast.wizard_last_step',
    );
  });

  it('marks the current step for assistive tech', () => {
    renderTabs({ activeIndex: 2 });
    expect(screen.getByTestId('object-wizard-step-access')).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  /* An error on a step you cannot see is exactly the one that needs announcing. */
  it('badges a step that has errors, even when it is hidden', () => {
    renderTabs({ activeIndex: 0, errors: { scope: 'bad' } });
    expect(screen.getByTestId('object-wizard-badge-access')).toHaveTextContent(
      '1',
    );
  });

  it('no badge when nothing is wrong', () => {
    renderTabs({ activeIndex: 2 });
    expect(screen.queryByTestId('object-wizard-badge-basic')).toBeNull();
  });

  it('jumping is unrestricted — read-only records must be walkable', () => {
    const onPick = vi.fn();
    renderTabs({ activeIndex: 0, onPick });
    fireEvent.click(screen.getByTestId('object-wizard-step-access'));
    expect(onPick).toHaveBeenCalledWith(2);
  });

  it('the review-all toggle reports its state to assistive tech', () => {
    renderTabs({ showAll: true });
    expect(
      screen.getByTestId('object-wizard-viewall-toggle'),
    ).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('back / next', () => {
  const renderNav = (over: Record<string, unknown> = {}) => {
    const onBack = vi.fn();
    const onNext = vi.fn();
    render(
      <ObjectStepNav
        activeIndex={1}
        stepCount={3}
        showAll={false}
        onBack={onBack}
        onNext={onNext}
        {...over}
      />,
    );
    return { onBack, onNext };
  };

  /* Both live inside a <form>; an untyped button submits it, so pressing
     "next" would save the record. */
  it('are type=button, never submit', () => {
    renderNav();
    expect(screen.getByTestId('object-wizard-next')).toHaveAttribute(
      'type',
      'button',
    );
    expect(screen.getByTestId('object-wizard-back')).toHaveAttribute(
      'type',
      'button',
    );
  });

  it('back is dead on the first step', () => {
    renderNav({ activeIndex: 0 });
    expect(screen.getByTestId('object-wizard-back')).toBeDisabled();
  });

  /* The last step's save button is the form's own — a second one there would
     leave the user guessing which actually commits. */
  it('there is no "next" on the last step', () => {
    renderNav({ activeIndex: 2 });
    expect(screen.queryByTestId('object-wizard-next')).toBeNull();
  });

  it('walking hides while every step is shown at once', () => {
    renderNav({ showAll: true });
    expect(screen.queryByTestId('object-wizard-next')).toBeNull();
    expect(screen.queryByTestId('object-wizard-back')).toBeNull();
  });

  /* Gated, but still clickable: a dead button explains nothing, whereas
     pressing it runs validation and paints the offending field. */
  it('a gated "next" says so without going dead', () => {
    const { onNext } = renderNav({ canGoNext: false });
    const next = screen.getByTestId('object-wizard-next');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(next);
    expect(onNext).toHaveBeenCalled();
  });
});

/**
 * [UI-20260901-STORAGETOSTEP2] The media step has to exist while CREATING.
 *
 * It used to be dropped in create mode, correctly: everything in it was a
 * gallery, and a gallery needs a saved album id. Storage, the path field and
 * the preview do not — and the local upload auto-saves the album and THEN
 * attaches the file, so a create that cannot reach its storage picker is pinned
 * to the `external` default with no way to say otherwise.
 */
describe('the media step exists in every mode', () => {
  const stepsFor = (mode: string) =>
    ['basic', 'media', 'access'].map((id) => ({
      id,
      label: id,
      fields: [],
      content: <p>{`${mode}-${id}`}</p>,
    }));

  const renderFor = (mode: string, activeIndex = 0) =>
    render(
      <ObjectFormTabs
        steps={stepsFor(mode)}
        activeIndex={activeIndex}
        showAll={false}
        errors={{}}
        onPick={() => {}}
        onToggleShowAll={() => {}}
      />,
    );

  it.each(['create', 'update', 'view'])('%s walks three steps', (mode) => {
    renderFor(mode);
    expect(screen.getByTestId('object-wizard-step-media')).toBeInTheDocument();
    expect(screen.getByTestId('object-wizard-position')).toHaveTextContent(
      'broadcast.wizard_step_of:1,3',
    );
  });

  /* Creating no longer lands on a blank page 2. */
  it('the media step renders content while creating, not an empty pane', () => {
    renderFor('create', 1);
    const pane = screen.getByTestId('object-wizard-pane-media');
    expect(pane).toHaveAttribute('data-step-visible', 'yes');
    expect(pane).toHaveTextContent('create-media');
  });
});
