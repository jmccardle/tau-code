import { imageLabel, type Image } from '@ffwf/tau-code-protocol';

/**
 * The images this page sent, by SHA-256: a `data:` URL of each. A node or an item names an image
 * only by `{mime, sha256, width, height}`; the bytes of one this page attached are already here, so
 * its own messages draw them. Keyed by content, an entry can never draw the wrong image. Every
 * other image is a label until a later slice fetches it (`image(sha256)`).
 *
 * One per page: the composer fills it, the transcript and the pending items read it.
 */
const sent = new Map<string, string>();

/** Keep `url` (a `data:` URL) as the image whose bytes hash to `sha256`. */
export function rememberImage(sha256: string, url: string): void {
  sent.set(sha256, url);
}

/** The `data:` URL of the image `sha256`, if this page has it. */
export function rememberedImage(sha256: string): string | undefined {
  return sent.get(sha256);
}

/**
 * A message's images, in order: each one this page holds drawn as a thumbnail, every other one as
 * τ labels it, `[image WxH mime]`.
 */
export function UserImages({ images }: { images: readonly Image[] }): JSX.Element | null {
  if (images.length === 0) return null;
  return (
    <ul className="tau-images tau-user-images">
      {images.map((image, i) => {
        const label = imageLabel(image);
        const url = rememberedImage(image.sha256);
        return (
          <li key={i} className="tau-image" title={`${label} sha256 ${image.sha256}`}>
            {url ? <img className="tau-thumb" src={url} alt={label} /> : label}
          </li>
        );
      })}
    </ul>
  );
}
