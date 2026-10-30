import { ItemView, Keymap, Notice, TFile, type WorkspaceLeaf } from 'obsidian';
import type RelatedPlugin from './main';
import { fetchRelated, RelatedError } from './api';
import type { RelatedResponse, RelatedItem, TrailItem, SimilarItem } from './parse';
import { addRelatedLink } from './related';

export const VIEW_TYPE = 'mcp-related-notes';

export class RelatedView extends ItemView {
  private cache = new Map<string, { at: number; data: RelatedResponse }>();
  private generation = 0;
  private closed = false;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: RelatedPlugin
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'Related';
  }
  getIcon(): string {
    return 'network';
  }
  async onOpen(): Promise<void> {
    this.closed = false;
    await this.reload();
  }
  async onClose(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.cache.clear();
  }
  invalidate(): void {
    this.generation++;
    this.cache.clear();
  }
  async reload(refresh = false): Promise<void> {
    const generation = ++this.generation;
    const file = this.app.workspace.getActiveFile();
    this.contentEl.empty();
    if (!file || file.extension !== 'md' || this.closed) return;
    const header = this.contentEl.createDiv({ cls: 'mcp-related-header' });
    const refreshButton = header.createEl('button', { text: 'Refresh' });
    refreshButton.addEventListener('click', () => {
      void this.reload(true);
    });
    const body = this.contentEl.createDiv();
    const { serverUrl, k } = this.plugin.settings;
    const token = this.plugin.token();
    if (!serverUrl || !token) {
      body.setText('Set the server URL and token in settings');
      return;
    }
    if (refresh) this.cache.delete(file.path);
    try {
      const cached = this.cache.get(file.path);
      const cacheHit = cached && Date.now() - cached.at < 5 * 60 * 1000;
      const data = cacheHit ? cached.data : await fetchRelated(serverUrl, token, file.path, k);
      if (
        generation !== this.generation ||
        this.closed ||
        this.app.workspace.getActiveFile()?.path !== file.path
      )
        return;
      if (!cacheHit) this.cache.set(file.path, { at: Date.now(), data });
      header.createEl('strong', { text: data.title });
      if (data.heat !== null)
        header.createSpan({ text: `heat ${data.heat.bucket}`, cls: 'mcp-related-heat' });
      for (const [label, items] of [
        ['Read together', data.trails],
        ['Similar', data.similar],
      ] as const) {
        body.createEl('h3', { text: label });
        const list = body.createEl('ul');
        for (const item of items) this.renderItem(list, item, file, generation);
      }
    } catch (error) {
      if (generation !== this.generation || this.closed) return;
      const status = error instanceof RelatedError ? error.status : 0;
      body.setText(
        status === 401 || status === 403
          ? 'Authentication failed'
          : status === 404
            ? 'Not indexed yet'
            : 'Brain server unreachable'
      );
    }
  }
  private renderItem(
    list: HTMLElement,
    item: RelatedItem,
    activeFile: TFile,
    generation: number
  ): void {
    const row = list.createEl('li');
    const link = row.createEl('a', { text: item.title, href: '#' });
    link.addEventListener('click', event => {
      event.preventDefault();
      void this.app.workspace.openLinkText(item.path, activeFile.path, Keymap.isModEvent(event));
    });
    row.createSpan({
      text:
        'events' in item ? ` ×${(item as TrailItem).events}` : ` ${(item as SimilarItem).score}`,
    });
    if (!item.linked) {
      const button = row.createEl('button', { text: 'Link' });
      button.addEventListener('click', async () => {
        if (
          generation !== this.generation ||
          this.app.workspace.getActiveFile()?.path !== activeFile.path
        )
          return;
        const target = this.app.vault.getAbstractFileByPath(item.path);
        if (!(target instanceof TFile) || target.extension !== 'md') return;
        button.disabled = true;
        try {
          const linktext = this.app.metadataCache.fileToLinktext(target, activeFile.path, true);
          await this.app.vault.process(activeFile, content => addRelatedLink(content, linktext));
          item.linked = true;
          button.remove();
        } catch {
          button.disabled = false;
          new Notice('Could not add related link');
        }
      });
    }
  }
}
