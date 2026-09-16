# Sign photos for Pitch Mode

Pitch Mode steps through each reconstructed sentence word by word and shows a static sign photo for the current word, over the live spectrogram and in the sign strip under the sentence. The photos live in this folder and are listed in `manifest.json`. The app ships without any, and a word with no photo shows a text card labelled "No photo yet", so a missing photo is never shown as a sign.

## Adding photos

1. Put the image files in this folder: `.jpg`, `.png`, `.webp`, `.avif`, `.gif` or `.svg`, with lower-case names and no sub-folders, for example `water.jpg`.
2. Add one entry per word to `manifest.json`:

   ```json
   {
     "version": 1,
     "language": "ASL",
     "attribution": "Photos: Jane Doe, CC BY 4.0",
     "signs": {
       "water": {
         "image": "water.jpg",
         "alt": "ASL sign for water: W handshape tapped twice on the chin",
         "credit": "Jane Doe, CC BY 4.0"
       }
     }
   }
   ```

   - `language` names the sign language and is shown in the overlay. Use one sign language per manifest.
   - Keys are lower-case words. Lookups also try the word without a trailing `'s` or plural `s`.
   - `alt` is required and should describe the handshape and movement, because a screen reader reads it instead of the photo.
   - `credit` is shown under the photo. Only add photos you have the right to redistribute, and record their licence in the repository's `ATTRIBUTION.md`.
3. Reload the app. No code change or rebuild of the backend is needed; `npm run build` copies this folder into the static export.

Articles and forms of "be" (a, an, the, am, is, are, was, were, be, been, being) are treated as unsigned and skipped in the sequence, since most sign languages leave them out.

Entries with a missing `alt`, an image path outside this folder, or an unsupported file type are ignored.
