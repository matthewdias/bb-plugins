// Dismiss the mobile keyboard when opening a surface that needs the room.
//
// Detection logic follows bb's own `overlay-trigger.ts`
// (`blurActiveKeyboardInputWithin`), which the scaffold ships for exactly this
// case. Reimplemented here rather than vendored because that file also
// registers document-level listeners this plugin does not use.

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

function isKeyboardInputElement(element: Element): element is HTMLElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) {
    return (
      !element.disabled &&
      !element.readOnly &&
      !NON_TEXT_INPUT_TYPES.has(element.type)
    );
  }
  if (!(element instanceof HTMLElement)) return false;
  // The bb composer is contenteditable, not an <input>.
  return (
    element.isContentEditable ||
    element.closest("[contenteditable='true']") !== null
  );
}

/**
 * Blur the focused text input so the on-screen keyboard retracts.
 *
 * Buttons here use `preventDefault` on mousedown so they never steal focus —
 * without that, blurring happened implicitly and minimised the composer before
 * the click landed. Focus is kept, then released deliberately, here.
 */
export function dismissKeyboard(): void {
  if (typeof document === "undefined") return;
  const active = document.activeElement;
  if (active === null || !isKeyboardInputElement(active)) return;
  active.blur();
}
