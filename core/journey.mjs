export function automaticBuildStep(kit, stepId) {
    const id = kit?.contract?.modules?.tasks?.buildStep || kit?.contract?.modules?.review?.buildStep;
    const step = id && kit.contract.steps.find(item => item.id === id);
    return !!(step && !step.approves?.length && stepId === id);
}

export function automaticallyCompletedBuild(kit, run) {
    const tasks = kit?.tasks?.[String(run?.unit)]?.sections?.flatMap(section => section.tasks) || [];
    const finished = run?.completion?.automatic === true || tasks.length > 0 && tasks.every(task => task.status === "done");
    return !!(automaticBuildStep(kit, run?.step) && finished && run.status === "produced"
        && run.reported === "produced" && run.evidence?.length && !run.endGate?.alert);
}

export function nextJourneyStep(steps, runs, unit, { tasks, review, preferSelectedUnit = false } = {}, stateOf = () => ({})) {
    const last = runs.findLast(run => steps.some(step => step.id === run.step) && (!preferSelectedUnit || run.unit === unit));
    unit = preferSelectedUnit ? unit : last?.unit || unit;
    const loop = tasks?.[String(unit)]?.loop;
    if (review && last?.step === review.reviewStep && loop?.step === "corrections") {
        const step = steps.find(step => step.id === review.buildStep);
        if (step) return { step, unit };
    }
    const start = last ? steps.findIndex(step => step.id === last.step) + 1 : 0;
    for (const step of steps.slice(start)) {
        const info = stateOf(step, unit);
        if (last ? !info.approved : !info.done && !info.blocked) return { step, unit };
    }
    return null;
}
