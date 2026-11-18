import { rooms } from './config.js';

/** @type {Record<string, Array<{id:number, name:string, mic_enabled?:boolean}>>} */
let presence = {};
let myClientId = null;
let targetRoom = null;

export function getMyClientId() {
  return myClientId;
}

export function setMyClientId(id) {
  myClientId = id;
}

export function getTargetRoom() {
  return targetRoom;
}

export function setTargetRoom(room) {
  targetRoom = room;
}

export function getMembers(room) {
  if (!room) return [];
  return presence[room] || [];
}

/** Полный снимок lobby: `{ roomName: Member[] }` */
export function setPresenceSnapshot(roomsMap) {
  presence = {};
  if (!roomsMap) return;
  for (const [room, value] of Object.entries(roomsMap)) {
    if (Array.isArray(value)) {
      presence[room] = value.slice();
    }
  }
}

export function setRoomMembers(room, members) {
  if (!room) return;
  presence[room] = Array.isArray(members) ? members.slice() : [];
  if (presence[room].length === 0) delete presence[room];
}

export function upsertMember(room, member) {
  if (!presence[room]) presence[room] = [];
  const idx = presence[room].findIndex((m) => m.id === member.id);
  if (idx >= 0) presence[room][idx] = member;
  else presence[room].push(member);
}

export function removeMember(room, id) {
  if (!presence[room]) return;
  presence[room] = presence[room].filter((m) => m.id !== id);
  if (presence[room].length === 0) delete presence[room];
}

export function renderRooms(roomsListEl, onSelectRoom) {
  const prevScroll = roomsListEl.scrollTop;
  roomsListEl.innerHTML = '';

  rooms.forEach((roomName) => {
    const block = document.createElement('div');
    block.className = 'room-block';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'room-btn';
    btn.dataset.room = roomName;
    const members = presence[roomName] || [];
    const n = members.length;
    btn.textContent = n > 0 ? `${roomName} (${n})` : roomName;
    if (targetRoom === roomName) btn.classList.add('active');
    btn.addEventListener('click', () => onSelectRoom(roomName));
    block.appendChild(btn);

    if (members.length > 0) {
      const ul = document.createElement('ul');
      ul.className = 'room-members';
      members
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
        .forEach((m) => {
          const li = document.createElement('li');
          li.textContent = m.name;
          if (m.id === myClientId) li.classList.add('self');
          ul.appendChild(li);
        });
      block.appendChild(ul);
    }

    roomsListEl.appendChild(block);
  });

  roomsListEl.scrollTop = prevScroll;
}

export function markRoomReconnecting(roomName) {
  document.querySelectorAll('.room-btn').forEach((btn) => {
    if (btn.dataset.room === roomName) {
      btn.classList.remove('active');
      btn.classList.add('reconnecting');
    }
  });
}
