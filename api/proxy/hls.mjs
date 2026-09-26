// Vercel function: /api/proxy/hls (playlists). Off when PLAYZANIME_RELAY=off.
import { handle } from '../_lib/app.mjs';

export default function hls(req, res) {
  return handle(req, res);
}
