/**
 * Who am I and which table am I at?
 *
 * Today this comes from the URL (?room=&name=&pid=) or localStorage. When we
 * move into Discord, this is the one place to swap for the Embedded App SDK:
 * playerId = Discord user id, name = display name, roomId = activity instanceId.
 */
export interface Identity { playerId: string; name: string; roomId: string }

const PID_KEY = 'flip7.pid';
const NAME_KEY = 'flip7.name';

function randomId() {
  return 'p-' + Math.random().toString(36).slice(2, 10);
}

export function initialIdentity(): { playerId: string; name: string | null; roomId: string } {
  const q = new URLSearchParams(location.search);
  let playerId = q.get('pid');
  if (!playerId) {
    playerId = localStorage.getItem(PID_KEY) ?? randomId();
    localStorage.setItem(PID_KEY, playerId);
  }
  const name = q.get('name') ?? localStorage.getItem(NAME_KEY);
  return { playerId, name, roomId: q.get('room') ?? 'main' };
}

export function rememberName(name: string) {
  localStorage.setItem(NAME_KEY, name);
}
