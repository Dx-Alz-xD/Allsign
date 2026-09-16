/**
 * Pure helpers for Electron accelerator strings, shared by the main process and the renderer.
 * No Electron imports, so the renderer bundle can use them too.
 */

type Modifier = 'Command' | 'Control' | 'Alt' | 'AltGr' | 'Shift' | 'Super';

const MODIFIER_ORDER: readonly Modifier[] = ['Command', 'Control', 'Alt', 'AltGr', 'Shift', 'Super'];

const NAMED_KEYS: readonly string[] = [
  'Plus', 'Space', 'Tab', 'Capslock', 'Numlock', 'Scrolllock', 'Backspace', 'Delete', 'Insert', 'Enter',
  'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'VolumeUp', 'VolumeDown',
  'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'PrintScreen',
  'num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
];
const KEY_ALIASES: Record<string, string> = { return: 'Enter', esc: 'Escape' };
const PUNCTUATION = ')!@#$%^&*(:;=<,_->.?/~`{][|\\}"';

/** Single keys that, with only Ctrl (Cmd on macOS), mean copy, paste, cut, undo, redo, or select all everywhere. */
const RESERVED_WITH_PRIMARY_MODIFIER = new Set(['A', 'C', 'V', 'X', 'Y', 'Z']);

interface ParsedAccelerator {
  modifiers: Modifier[];
  key: string;
}

function normalizeModifier(token: string, platform: string): Modifier | null {
  switch (token.toLowerCase()) {
    case 'commandorcontrol':
    case 'cmdorctrl':
      return platform === 'darwin' ? 'Command' : 'Control';
    case 'command':
    case 'cmd':
      return 'Command';
    case 'control':
    case 'ctrl':
      return 'Control';
    case 'alt':
    case 'option':
      return 'Alt';
    case 'altgr':
      return 'AltGr';
    case 'shift':
      return 'Shift';
    case 'super':
      return 'Super';
    case 'meta':
      return platform === 'darwin' ? 'Command' : 'Super';
    default:
      return null;
  }
}

function normalizeKey(token: string): string | null {
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase();
  const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(token);
  if (functionKey) return `F${functionKey[1]}`;
  if (token.length === 1 && PUNCTUATION.includes(token)) return token;
  const alias = KEY_ALIASES[token.toLowerCase()];
  if (alias) return alias;
  return NAMED_KEYS.find((key) => key.toLowerCase() === token.toLowerCase()) ?? null;
}

function parseAccelerator(accelerator: string, platform: string): ParsedAccelerator | null {
  const tokens = accelerator.split('+');
  if (tokens.length === 0 || tokens.some((token) => token.trim() === '')) return null;

  const key = normalizeKey(tokens[tokens.length - 1].trim());
  if (!key) return null;

  const modifiers: Modifier[] = [];
  for (const token of tokens.slice(0, -1)) {
    const modifier = normalizeModifier(token.trim(), platform);
    if (!modifier || modifiers.includes(modifier)) return null;
    modifiers.push(modifier);
  }
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return { modifiers, key };
}

/** Platform-resolved form used to compare shortcuts, e.g. CommandOrControl+Shift+P becomes Control+Shift+P on Linux. */
export function canonicalAccelerator(accelerator: string, platform: string): string | null {
  const parsed = parseAccelerator(accelerator, platform);
  return parsed ? [...parsed.modifiers, parsed.key].join('+') : null;
}

export type AcceleratorCheck = { ok: true; canonical: string } | { ok: false; message: string };

export function checkAccelerator(accelerator: string, platform: string): AcceleratorCheck {
  const parsed = parseAccelerator(accelerator, platform);
  if (!parsed) return { ok: false, message: 'That key combination cannot be used as a shortcut.' };

  if (!parsed.modifiers.some((modifier) => modifier !== 'Shift')) {
    return {
      ok: false,
      message:
        platform === 'darwin'
          ? 'Include Cmd, Control, or Option so the shortcut does not block normal typing.'
          : 'Include Ctrl, Alt, or Super so the shortcut does not block normal typing.',
    };
  }

  const primary: Modifier = platform === 'darwin' ? 'Command' : 'Control';
  if (parsed.modifiers.length === 1 && parsed.modifiers[0] === primary && RESERVED_WITH_PRIMARY_MODIFIER.has(parsed.key)) {
    return { ok: false, message: 'That shortcut is used for copy, paste, or undo in almost every app.' };
  }

  return { ok: true, canonical: [...parsed.modifiers, parsed.key].join('+') };
}

/** Key names as people see them on their keyboard, e.g. ['Ctrl', 'Shift', 'P'] or ['Cmd', 'Option', 'E']. */
export function displayAcceleratorKeys(accelerator: string, platform: string): string[] {
  const parsed = parseAccelerator(accelerator, platform);
  if (!parsed) return accelerator.split('+');
  const names: Record<Modifier, string> = {
    Command: 'Cmd',
    Control: 'Ctrl',
    Alt: platform === 'darwin' ? 'Option' : 'Alt',
    AltGr: 'AltGr',
    Shift: 'Shift',
    Super: platform === 'win32' ? 'Win' : 'Super',
  };
  return [...parsed.modifiers.map((modifier) => names[modifier]), parsed.key === 'Plus' ? '+' : parsed.key];
}

const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Enter: 'Enter',
  NumpadEnter: 'Enter', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home',
  End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape', PrintScreen: 'PrintScreen',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Comma: ',',
  Period: '.', Slash: '/', Backquote: '`', NumpadAdd: 'numadd', NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
};

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS|AltGraph)(Left|Right)?$/;

export interface RecordedKeys {
  /** Complete accelerator, or null while only modifiers are held or the key is unsupported. */
  accelerator: string | null;
  /** Modifiers currently held, for live feedback. */
  heldKeys: string[];
  unsupportedKey: boolean;
}

/** Builds an accelerator from a keydown event using physical key codes, so it works on any keyboard layout. */
export function acceleratorFromKeyboardEvent(
  event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  platform: string,
): RecordedKeys {
  const modifiers: Modifier[] = [];
  if (event.metaKey) modifiers.push(platform === 'darwin' ? 'Command' : 'Super');
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  modifiers.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  const heldKeys = displayAcceleratorKeys([...modifiers, 'A'].join('+'), platform).slice(0, -1);

  if (MODIFIER_CODES.test(event.code)) return { accelerator: null, heldKeys, unsupportedKey: false };

  let key: string | undefined = CODE_TO_KEY[event.code];
  const letter = /^Key([A-Z])$/.exec(event.code);
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
  const functionKey = /^F([1-9]|1[0-9]|2[0-4])$/.exec(event.code);
  if (letter) key = letter[1];
  else if (digit) key = event.code.startsWith('Numpad') ? `num${digit[1]}` : digit[1];
  else if (functionKey) key = event.code;

  if (!key) return { accelerator: null, heldKeys, unsupportedKey: true };
  return { accelerator: [...modifiers, key].join('+'), heldKeys, unsupportedKey: false };
}
