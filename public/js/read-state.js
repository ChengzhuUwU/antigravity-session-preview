/**
 * Sidebar unread highlights.
 *
 * `seen` is the step count the user has already caught up with. A session is
 * unread only when it is idle, not on screen, and its step count is still
 * ahead of that. Watching a live run counts as reading it. A run that stops
 * without new steps, or a running flag that flickers, must not light the
 * project again.
 *
 * The project folder uses the same rule, and only for rows the user can
 * already see. Collapsed subagents and sessions behind "older" do not keep
 * the folder highlighted after the visible ones have been read.
 */

const FRESH_UNREAD_MS = 5 * 60 * 1000;

export function nextConversationReadState({
  steps = 0,
  running = false,
  viewed = false,
  wasRunning = false,
  prevSeen,
  wasUnread = false,
  updatedAt = 0,
  now = 0,
} = {}) {
  const safeSteps = Math.max(0, Number(steps) || 0);
  const hadSeen = prevSeen !== undefined && prevSeen !== null && Number.isFinite(Number(prevSeen));
  const seenBefore = hadSeen ? Math.max(0, Number(prevSeen) || 0) : undefined;

  if (viewed) {
    const seen = Math.max(seenBefore || 0, safeSteps);
    return {
      unread: false,
      seen,
      trackRunning: Boolean(running),
      changed: Boolean(wasUnread) || seenBefore !== seen,
    };
  }

  if (running) {
    return {
      unread: false,
      seen: seenBefore,
      trackRunning: true,
      changed: Boolean(wasUnread),
    };
  }

  const advanced = hadSeen && safeSteps > seenBefore;
  const fresh = !hadSeen && safeSteps > 0 && (now - (Number(updatedAt) || 0) < FRESH_UNREAD_MS);
  const finishedUnseen = Boolean(wasRunning) && safeSteps > (hadSeen ? seenBefore : 0);

  let unread = Boolean(wasUnread);
  let seen = seenBefore;
  let changed = false;

  if (finishedUnseen || advanced || fresh) {
    if (!unread) {
      unread = true;
      changed = true;
    }
    // Leave a first sighting behind the current count so the next poll
    // still sees unread until the user opens the session.
    if (!hadSeen) {
      seen = 0;
      changed = true;
    }
  } else if (!hadSeen) {
    seen = safeSteps;
    changed = true;
  } else if (unread && safeSteps <= seenBefore) {
    unread = false;
    changed = true;
  }

  return {
    unread,
    seen,
    trackRunning: false,
    changed,
  };
}

export function folderShowsUnread(sessions, {
  unreadIds,
  runningIds,
  activeId = '',
  countableIds,
} = {}) {
  const unread = unreadIds instanceof Set ? unreadIds : new Set(unreadIds || []);
  const running = runningIds instanceof Set ? runningIds : new Set(runningIds || []);
  const countable = countableIds instanceof Set ? countableIds : new Set(countableIds || []);
  for (const session of sessions || []) {
    const id = session?.id;
    if (!id || !countable.has(id)) continue;
    if (activeId && id === activeId) continue;
    if (running.has(id)) continue;
    if (unread.has(id)) return true;
  }
  return false;
}
