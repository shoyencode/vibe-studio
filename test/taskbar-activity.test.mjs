import test from "node:test";
import assert from "node:assert/strict";
import { TaskbarActivity } from "../app/taskbar-activity.mjs";

test("native taskbar activity waits 200ms and stays until all concurrent work ends", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const calls = [], win = { isDestroyed: () => false, setProgressBar: (...args) => calls.push(args) };
    const activity = new TaskbarActivity(() => win, "win32");
    const first = activity.begin("/launch"), second = activity.begin("/costs");
    t.mock.timers.tick(199); assert.deepEqual(calls, []);
    t.mock.timers.tick(1); assert.deepEqual(calls, [[2, { mode: "indeterminate" }]]);
    first(); first(); assert.equal(calls.length, 1);
    activity.setRunning(true); second(); assert.equal(calls.length, 1);
    activity.setRunning(false); assert.deepEqual(calls.at(-1), [-1]);
    activity.setRunning(false); assert.equal(calls.length, 2);
    const later = activity.begin("/prepare");
    t.mock.timers.tick(200); assert.deepEqual(calls.at(-1), [2, { mode: "indeterminate" }]);
    later(); assert.deepEqual(calls.at(-1), [-1]);
});

test("background reads and short actions do not flash a loading indicator", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const calls = [], activity = new TaskbarActivity(() => ({ isDestroyed: () => false, setProgressBar: (...args) => calls.push(args) }), "win32");
    for (const route of ["/projects", "/snapshot", "/conversation", "/app/logs"]) activity.begin(route)();
    const done = activity.begin("/prepare"); done();
    t.mock.timers.tick(1000);
    assert.deepEqual(calls, []);
});

test("closing the app cancels animation and late completions cannot restart it", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const calls = [], activity = new TaskbarActivity(() => ({ isDestroyed: () => false, setProgressBar: (...args) => calls.push(args) }), "win32");
    const done = activity.begin("/launch");
    t.mock.timers.tick(200);
    activity.dispose(); done(); activity.setRunning(true); activity.begin("/costs")();
    t.mock.timers.tick(1000);
    assert.deepEqual(calls, [[2, { mode: "indeterminate" }], [-1]]);
});

test("unsupported platforms and destroyed windows receive no native progress calls", t => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    for (const platform of ["linux", "darwin", "win32"]) {
        const activity = new TaskbarActivity(() => ({ isDestroyed: () => true, setProgressBar: () => assert.fail("destroyed window") }), platform);
        activity.setRunning(true); t.mock.timers.tick(200); activity.dispose();
    }
});
