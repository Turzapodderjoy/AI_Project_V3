import { CrawlerService } from "@ai-chat-platform/web-crawler";

export class CrawlerController {
  constructor(
    private readonly crawler: CrawlerService
  ) {}

  list(businessId?: string) {
    return this.crawler.listTargets(businessId);
  }

  add(businessId: string, url: string) {
    new URL(url); // throws on malformed input
    return this.crawler.addTarget(businessId, url);
  }

  recrawlOne(id: string) {
    return this.crawler.crawlTarget(id);
  }

  recrawlAll() {
    return this.crawler.crawlAll();
  }
}
