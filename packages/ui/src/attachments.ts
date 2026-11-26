import { sha256 as noble256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import type { ImageInput } from '@ffwf/tau-code-protocol';
import type { Call } from './line.js';

/**
 * Images attached to a message (protocol 3, τ's D31): what the composer's tray holds, and the
 * checks it makes before anything is sent.
 *
 * The server owns every limit; these checks are a courtesy, so a person hears at once that a file
 * is not an image or is too big, rather than after a send. They are τ's fixed limits for 0.18
 * (`tau.MAX_INPUT_IMAGES`, `tau.MAX_INPUT_BYTES`) and the HTTP edge's body cap. A model that takes
 * no images, or takes smaller ones, is the server's to say: a refused send says why.
 *
 * Pure but for `Blob.arrayBuffer` and the page's image cache: no
 * DOM, so `node --test` runs it.
 */

/** The most images one message may carry (`tau.MAX_INPUT_IMAGES`). */
export const MAX_IMAGES = 20;
/** The most bytes one image may be, before base64 (`tau.MAX_INPUT_BYTES`, 20 MiB). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** The most bytes one request may carry to the HTTP edge (`MAX_BODY`; more is a 413). */
export const MAX_REQUEST_BYTES = 64 * 1024 * 1024;
/**
 * What a request carries besides its images' base64: the JSON-RPC envelope, the cursor, the
 * field names. Generous, so a message the check lets through is never a 413.
 */
const ENVELOPE_BYTES = 64 * 1024;

/** The formats τ reads (it sniffs the bytes, as `sniff` does here). */
export const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
/** The file picker's `accept`. */
export const IMAGE_ACCEPT = IMAGE_MIMES.join(',');

/** One image in the tray. */
export interface Attached {
  /** This tray's own id for it (two files may share a name). */
  id: number;
  /** The file's name, or `pasted image` for a clipboard image with none. */
  name: string;
  mime: ImageMime;
  /** Its size in bytes, before base64. */
  bytes: number;
  /** Its bytes in standard, padded base64: what `send` carries. */
  data: string;
  /** Lowercase hex SHA-256 of its bytes: the name τ will give it. */
  sha256: string;
  /** A `data:` URL of it, for the thumbnail (the pages' CSPs allow `img-src data:`, not `blob:`). */
  url: string;
}

/** A file as the composer is handed one: a `File` from a picker, a paste or a drop. */
export interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The format of `bytes`, by their first bytes, as τ reads it; null for anything else. */
export function sniff(bytes: Uint8Array): ImageMime | null {
  const starts = (...prefix: number[]) => prefix.every((b, i) => bytes[i] === b);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** `bytes` in standard base64, padded: what τ decodes strictly. */
export function base64(bytes: Uint8Array): string {
  let out = '';
  // btoa takes a "binary string"; built in slices so a 20 MiB image does not blow the call stack.
  // A slice is a multiple of 3 bytes, so no slice but the last is padded.
  const SLICE = 3 * 0x2000;
  for (let i = 0; i < bytes.length; i += SLICE) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + SLICE)));
  }
  return out;
}

/** The base64 length of `n` bytes. */
function base64Length(n: number): number {
  return Math.ceil(n / 3) * 4;
}

/**
 * Lowercase hex SHA-256 of `bytes`, by @noble/hashes: pure JavaScript, the same everywhere. Not
 * `crypto.subtle`, which a browser withholds from a page that is not a secure context (plain
 * http on a LAN address), where attaching would fail.
 */
export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(noble256(bytes));
}

/** A size, for a person: `512 B`, `1.5 KiB`, `20.0 MiB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** The files a paste's `clipboardData` or a drop's `dataTransfer` carries; none for neither. */
export function filesOf(transfer: { files?: ArrayLike<FileLike> | null } | null | undefined): FileLike[] {
  return transfer?.files ? Array.from(transfer.files) : [];
}

/** What the request carrying `tray` would weigh, `text` included. */
export function requestBytes(tray: readonly Pick<Attached, 'data'>[], text: string): number {
  return ENVELOPE_BYTES + JSON.stringify(text).length * 3 + tray.reduce((sum, image) => sum + image.data.length, 0);
}

let nextId = 0;

/**
 * Read `files` into the tray, each checked: an image τ reads, at most `MAX_IMAGE_BYTES`, while the
 * tray has room (`MAX_IMAGES`) and the request stays under `MAX_REQUEST_BYTES`. One already in the
 * tray (the same bytes) is not added twice. Returns the new tray and a sentence for each file that
 * was not added; the tray given is not changed.
 */
export async function attach(
  tray: readonly Attached[],
  files: readonly FileLike[],
): Promise<{ tray: Attached[]; problems: string[] }> {
  const out = [...tray];
  const problems: string[] = [];
  for (const file of files) {
    const name = file.name || 'pasted image';
    if (file.size > MAX_IMAGE_BYTES) {
      problems.push(`${name} is ${sizeText(file.size)}: an image may be at most ${sizeText(MAX_IMAGE_BYTES)}`);
      continue;
    }
    if (out.length >= MAX_IMAGES) {
      problems.push(`${name} not attached: a message carries at most ${MAX_IMAGES} images`);
      continue;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniff(bytes);
    if (mime === null) {
      problems.push(`${name} is not a png, jpeg, gif or webp image`);
      continue;
    }
    const weight = requestBytes(out, '') + base64Length(bytes.length);
    if (weight > MAX_REQUEST_BYTES) {
      problems.push(
        `${name} not attached: with it the message would be over the ${sizeText(MAX_REQUEST_BYTES)} ` +
          `one request may carry. send these first`,
      );
      continue;
    }
    const sha256 = sha256Hex(bytes);
    if (out.some((image) => image.sha256 === sha256)) {
      problems.push(`${name} is attached already`);
      continue;
    }
    const data = base64(bytes);
    out.push({ id: nextId++, name, mime, bytes: bytes.length, data, sha256, url: `data:${mime};base64,${data}` });
  }
  return { tray: out, problems };
}

/** The tray without the image `id`. */
export function detach(tray: readonly Attached[], id: number): Attached[] {
  return tray.filter((image) => image.id !== id);
}

/** The tray as `send`'s `images`: each image's bytes. */
export function imageInputs(tray: readonly Attached[]): ImageInput[] {
  return tray.map((image) => ({ data: image.data }));
}

/**
 * Why `line` cannot go with `tray`, or null when it can. Images go with a plain message only: a
 * `/command` is read by the server and run, and a command's text has nowhere to put an image
 * (τ's D31 §7). An empty line may carry images alone; the request must fit the edge's cap.
 */
export function trayProblem(line: string, tray: readonly Attached[]): string | null {
  if (tray.length === 0) return null;
  if (line.startsWith('/')) {
    return 'images go with a message, not a /command: send the command without them, or remove the /';
  }
  const weight = requestBytes(tray, line);
  if (weight > MAX_REQUEST_BYTES) {
    return `the message is ${sizeText(weight)} with its images, over the ${sizeText(MAX_REQUEST_BYTES)} one request may carry`;
  }
  return null;
}

/**
 * `send` `line` with `images`, and say which went: their tray ids. Each image is remembered first
 * (the page's cache, by SHA-256), so its node draws it when it arrives, whichever comes first.
 * A refusal (`Refused`: the model takes no images; `InvalidParams`: an image the server would not
 * read) throws, and the caller keeps its tray and line: nothing was queued.
 */
export async function sendImages(
  call: Call,
  cursor: number,
  line: string,
  images: readonly Attached[],
  remember: (sha256: string, url: string) => void,
): Promise<Set<number>> {
  for (const image of images) remember(image.sha256, image.url);
  await call('send', { cursor, text: line, images: imageInputs(images) });
  return new Set(images.map((image) => image.id));
}
