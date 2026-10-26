export function autoApprove(preferences, forced) {
    return !forced && (preferences.autopilot === true || preferences.approveAll === true);
}
