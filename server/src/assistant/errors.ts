// Kept free of imports so the HTTP error handler can recognise these without
// loading the assistant (which would create an import cycle).

/** A second message arrived while the previous one is still being answered. */
export class ConversationBusyError extends Error {
  constructor() {
    super("I'm still answering your last message. Please wait a moment.");
  }
}

/** Claude rejected this conversation's stored history; it cannot continue. */
export class ConversationBrokenError extends Error {
  constructor() {
    super("This conversation can't continue. Please tap New conversation and ask again.");
  }
}
