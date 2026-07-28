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
  /** The persisted assistant Message's id — lets the caller (Chat Demo's
   * QA buttons) attach pass/fail feedback to this exact answer. Absent
   * for the "already waiting on a human agent" path, which records no
   * new message. */
  messageId?: string;
}