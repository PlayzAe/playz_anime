// Vercel function: /api/proxy/file (manga pages that need a Referer; video segments when the relay is on).
import { handle } from '../_lib/app.mjs';

export default function file(req, res) {
  return handle(req, res);
}
