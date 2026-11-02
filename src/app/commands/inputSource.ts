// Was a command run from the keyboard? A tool that needs a rectangle then
// offers a keyboard rectangle instead of waiting for a drag (M4-Q10, rule 12).

let pointerAt = 0;
if (typeof window !== 'undefined')
  window.addEventListener(
    'pointerdown',
    () => {
      pointerAt = performance.now();
    },
    true,
  );

/** No pointer press in the last half second. */
export const fromKeyboard = (): boolean => performance.now() - pointerAt > 500;
