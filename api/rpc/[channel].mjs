// Vercel function: /api/rpc/<channel>. All the work happens in the shared handler.
import { handle } from '../_lib/app.mjs';

export default function rpc(req, res) {
  return handle(req, res);
}
