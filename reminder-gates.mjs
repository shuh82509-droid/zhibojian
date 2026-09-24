/** Explicit per-kind switches prevent an interview-only release from later
 * starting coach sends merely because a coach completes OAuth authorization. */
export function reminderScheduleConfig(env, recoveryReadOnly) {
  const scheduler=!recoveryReadOnly && env.LIFECYCLE_SCHEDULER_ENABLED !== '0';
  const leader=env.LIFECYCLE_REMINDER_LEADER === 'true';
  // Reminders have their own leader and journal. Turning on the 17:00 reminder
  // must not implicitly start the unrelated 09:30/18:00 refresh scheduler.
  const enabled=!recoveryReadOnly && leader && env.LIFECYCLE_REMINDERS_ENABLED === 'true';
  return {
    scheduler,leader,enabled,
    interview:enabled && env.LIFECYCLE_INTERVIEW_REMINDERS_ENABLED === 'true',
    coach:enabled && env.LIFECYCLE_COACH_REMINDERS_ENABLED === 'true',
  };
}
