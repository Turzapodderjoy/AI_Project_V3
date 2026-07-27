export interface AIRequest {
  userId: string;
  message: string;
  sessionId: string;
  /** 0.0-1.0. Providers that support it should pass this straight through
   * to their completion call; providers that don't can ignore it. */
  temperature?: number;
}

export interface AIResponse {
  success: boolean;
  provider: string;
  message: string;
  tokens?: number;
  error?: string;
}

export interface ProviderKey {
  id: string;
  value: string;
}

export interface AIProvider {
  readonly name: string;

  generate(
    request: AIRequest,
    apiKey?: string
  ): Promise<AIResponse>;

  health?(): Promise<boolean>;
}