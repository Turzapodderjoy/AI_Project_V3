export interface PromptHistoryTurn {
  role: string;
  content: string;
}

export interface PromptInput {
  systemPrompt: string;
  context: string[];
  history?: PromptHistoryTurn[];
  userMessage: string;
}

export interface PromptOutput {
  prompt: string;
}
