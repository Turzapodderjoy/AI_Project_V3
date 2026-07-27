export interface ChatRequest {
  sessionId: string;

  message: string;

  businessId?: string;
}

export interface ChatResponse {
  answer: string;
  provider: string;
  tokens: number;
  confidence: number;
  cached?: boolean;
  handoff?: boolean;
}