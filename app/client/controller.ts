export type ChatRequestState =
  | "preparing"
  | "streaming"
  | "stopping"
  | "finished"
  | "failed"
  | "canceled";

interface ControllerEntry {
  sessionId: string;
  messageId: string;
  controller: AbortController;
  state: ChatRequestState;
}

const controllers = new Map<string, ControllerEntry>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function key(sessionId: string, messageId: string) {
  return `${sessionId},${messageId}`;
}

export const ChatControllerPool = {
  begin(sessionId: string, messageId: string, controller: AbortController) {
    if (this.hasPending(sessionId)) return false;
    controllers.set(key(sessionId, messageId), {
      sessionId,
      messageId,
      controller,
      state: "preparing",
    });
    emit();
    return true;
  },

  addController(
    sessionId: string,
    messageId: string,
    controller: AbortController,
  ) {
    const entry = controllers.get(key(sessionId, messageId));
    if (!entry) {
      this.begin(sessionId, messageId, controller);
      return key(sessionId, messageId);
    }
    if (entry.controller.signal.aborted) controller.abort();
    else {
      entry.controller.signal.addEventListener(
        "abort",
        () => controller.abort(),
        { once: true },
      );
    }
    return key(sessionId, messageId);
  },

  setState(sessionId: string, messageId: string, state: ChatRequestState) {
    const entry = controllers.get(key(sessionId, messageId));
    if (!entry || entry.state === state) return;
    entry.state = state;
    emit();
  },

  stop(sessionId: string, messageId: string) {
    const entry = controllers.get(key(sessionId, messageId));
    if (!entry || entry.state === "stopping") return;
    entry.state = "stopping";
    emit();
    entry.controller.abort();
  },

  stopSession(sessionId: string) {
    const entries = [...controllers.values()].filter(
      (entry) => entry.sessionId === sessionId,
    );
    entries.forEach((entry) => {
      entry.state = "stopping";
    });
    if (entries.length) emit();
    entries.forEach((entry) => entry.controller.abort());
  },

  stopAll() {
    controllers.forEach((entry) => {
      entry.state = "stopping";
    });
    if (controllers.size) emit();
    controllers.forEach((entry) => entry.controller.abort());
  },

  hasPending(sessionId?: string) {
    return [...controllers.values()].some(
      (entry) =>
        (!sessionId || entry.sessionId === sessionId) &&
        ["preparing", "streaming", "stopping"].includes(entry.state),
    );
  },

  getSnapshot(sessionId: string) {
    return (
      [...controllers.values()].find((entry) => entry.sessionId === sessionId)
        ?.state ?? "finished"
    );
  },

  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  remove(sessionId: string, messageId: string) {
    if (controllers.delete(key(sessionId, messageId))) emit();
  },

  key,
};
