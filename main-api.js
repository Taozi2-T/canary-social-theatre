const symbol = Symbol.for('sillytavern.theatre.main-api-queue');
const state = () => globalThis[symbol] ??= { tail: Promise.resolve() };
export function withMainApi(task) {
    const queue = state();
    const request = queue.tail.then(task);
    queue.tail = request.then(() => {}, () => {});
    return request;
}
export function waitForMainApi() { return state().tail; }
