export class AIManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target?.name ?? "AIManagerError";
    Object.setPrototypeOf(this, new.target?.prototype ?? new.target);
  }
}

/** Provider must throw this instead of swallowing the error — it's what
 * tells AIManager to permanently disable the key instead of just cooling
 * it down, so a dead key stops being retried forever. */
export class InvalidApiKeyError extends AIManagerError {}

/** Provider must throw this instead of swallowing the error — it's what
 * tells AIManager this key is temporarily exhausted (cooldown) rather
 * than genuinely broken, and to record the failure for health tracking. */
export class RateLimitedError extends AIManagerError {}

export class ProviderUnavailableError extends AIManagerError {}

export class AllProvidersFailedError extends AIManagerError {
  constructor(public readonly failures: Error[]) {
    super("All AI providers failed.");
  }
}
