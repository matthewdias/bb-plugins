# Question Dock

When an agent asks you something, bb puts the question above the composer
and lets it grow to the height of the chat, with its options in a scroller of
their own inside the chat's. A long question covers the conversation it is
asking about. Question Dock moves the card out of the way: into a column
beside the chat, over the chat where you drag it, or into a sheet on a phone.

It is bb's card that moves, not a copy. Answering, the 1–9 shortcuts, Escape,
option previews and the tabs of a multi-question form all stay bb's own.

## Install

```sh
bb plugin install "git:https://github.com/matthewdias/bb-plugins.git@semver:*" \
  --subdirectory plugins/question-dock --tag-prefix question-dock/
```

## Using it

- **Docked.** On a window where the thread is at least 960px wide, an open
  question takes a column on the right of the thread, bottom-aligned beside
  the composer: 45% of the thread's width, between 440 and 640px. The chat
  and the composer move over for it. Drag the column's left edge to make it
  wider or narrower; the width is remembered on that device, and the chat
  always keeps at least 520px. Collapse the card and it goes back to bb's
  one-line bar above the composer.
- **Floating.** Drag the card by its header, marked by a grip at its start
  and a grab cursor, to float it. It stays above the
  composer and can't be dragged off the thread. It reopens where you dropped
  it, on that device. Collapsed, a float stays put as a one-line chip. A card
  dropped in the lower half of the thread keeps its bottom edge as it shrinks
  or grows, and one dropped in the upper half keeps its top edge.
- **Back to the dock.** Drag a float to the right edge of the thread. A
  dashed outline shows the dock column; release to dock. Double-clicking the
  header switches between the two.
- **On a phone** (or any touch screen without hover, or a window under
  768px), an open card is a sheet from the bottom of the screen, over a
  dimmed chat. Swipe the handle up or down: it settles at half or nearly all
  of the screen, and remembers which. Swipe it most of the way down, or tap
  the chat, and it becomes bb's bar above the composer; tap the bar to bring
  it back. The sheet keeps clear of the on-screen keyboard.

A press on the header is still bb's expand/collapse click. It only becomes a
drag after the pointer moves.

Plan reviews and plugin forms (Grill's rounds, for one) use the same card
and move the same way. Approvals stay beside the composer. When a thread has
two cards at once, which is rare, the first moves and the second stays.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Where questions open on a wide window | Dock beside the chat | **Float over the chat** floats every card where you last dropped one. **Leave it above the composer** turns the desktop behaviour off. |
| Open questions as a sheet on phones | On | Off leaves the card where bb puts it on a phone. |

What you do by dragging (dock or float, the dock's width, the float's
position, the sheet's height) is remembered per device, and wins over the setting. **Question
Dock: Reset card position** in the palette forgets it.

## Commands

- **Question Dock: Dock card**: dock cards from now on, on this device.
- **Question Dock: Float card**: float them.
- **Question Dock: Reset card position**: back to the setting, the default
  dock width, the default spot and the default sheet height.

## How it works

No plugin slot replaces bb's question card, so Question Dock positions the
one bb draws. It finds the card by its `data-testid`
(`user-question-banner`, `plan-review-banner`, `plugin-interaction-shell`).
It marks the card, the thread's sticky footer and the thread's scroller with
data attributes and CSS variables, and its stylesheet places them. React
never sets those attributes, so it never removes them, and a
`MutationObserver` re-applies them whenever bb redraws the card. Everything
is keyed on attributes bb publishes (`data-testid`, `data-expanded`,
`data-scroll-footer`, `data-page-scroll-viewport`). If bb renames one, the
card is simply not moved.

The plugin has to undo two things to lift the card:

- **bb sizes the card from the chat.** It sets an inline `max-height` of
  nearly the chat's whole height, and its body has a scroller of its own. The
  stylesheet overrides both while the card is lifted.
- **The scroller is a CSS container.** bb's thread scroller is a container,
  and some engines place fixed elements inside a container relative to it, so
  the card would scroll away with the chat. While a card is lifted, the
  stylesheet turns that container off. Only one bb rule queries it: an icon
  size below 560px. Any other ancestor that shifts fixed positioning (a
  transform, say) is handled by measuring where the card landed and
  correcting the difference.

Checked against bb 0.45.0.

## Development

```sh
npm run typecheck --workspace=bb-plugin-question-dock
npm test --workspace=bb-plugin-question-dock
bb plugin dev plugins/question-dock
```

`tests/geometry.test.ts` covers where cards go. `tests/ui/controller.test.ts`
runs the controller against a copy of bb's markup for a pending question.
