import { ChatController } from "./chat-controller";
import { UploadController } from "./upload-controller";
import { HealthController } from "./health-controller";
import { AdminController } from "./admin-controller";
import { HandoffController } from "./handoff-controller";

export class ApiRouter {
  constructor(
    readonly chat: ChatController,
    readonly upload: UploadController,
    readonly health: HealthController,
    readonly admin: AdminController,
    readonly handoff: HandoffController
  ) {}
}
