// macOS system notification. Used where the tool has no way to show the user a
// message without blocking (Cursor when it lets the message through).
import { spawn } from 'node:child_process';

export function notify(title, body) {
  if (process.platform !== 'darwin') return;
  const q = (s) => JSON.stringify(String(s).slice(0, 240));
  try {
    spawn('osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`], { stdio: 'ignore', detached: true }).unref();
  } catch {}
}
