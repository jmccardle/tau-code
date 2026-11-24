/** Test helpers. Not a test file: node --test runs it and finds none. */

/** A transport whose far end is this test. */
export function pair() {
  const sent = [];
  let deliver = () => {};
  let closeHandler = () => {};
  let closed = false;
  const transport = {
    send: (message) => sent.push(message),
    onMessage: (handler) => (deliver = handler),
    onClose: (handler) => (closeHandler = handler),
    close: () => {
      if (closed) return;
      closed = true;
      closeHandler('closed by this client');
    },
  };
  return {
    transport,
    sent,
    deliver: (message) => deliver(message),
    drop: (reason) => {
      closed = true;
      closeHandler(reason);
    },
  };
}

/** A CursorView with the defaults of a cursor at rest. */
export function view(cursor, at, extra = {}) {
  return {
    kind: 'CursorView',
    cursor,
    at,
    busy: false,
    auto: false,
    questions: [],
    items: [],
    ending: null,
    hook_error: null,
    model: 'm',
    shown: [],
    ...extra,
  };
}

/** A node: `User` text by a frontend unless a body is given. */
export function node(id, parent, body = { User: `text ${id}` }, by = { Frontend: 'me' }) {
  return { id, parent, time: 0, by, body, delivers: [] };
}

export function live(cursor, delta) {
  return { kind: 'Live', cursor, delta };
}
