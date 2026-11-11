/**
 * Runs `attempt` and returns what it threw, or undefined when it did not throw, so a test can
 * assert on a failure's type and fields without a try block of its own.
 */
export async function thrownBy(attempt: () => Promise<unknown>): Promise<unknown> {
  try {
    await attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}
