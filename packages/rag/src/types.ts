export interface AskRequest {
  sessionId: string;
  message: string;
  businessId?: string;
}

export interface AskResponse {
  answer: string;
  provider: string;
  tokens: number;
  confidence: number;
  cached?: boolean;
  handoff?: boolean;
}