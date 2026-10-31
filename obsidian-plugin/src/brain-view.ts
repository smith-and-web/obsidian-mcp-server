import { ItemView, type WorkspaceLeaf } from 'obsidian';
import type RelatedPlugin from './main';
import { fetchGraph, RelatedError } from './api';
import type { GraphResponse } from './graph-parse';
import { buildModel } from './brain-model';
import { layout } from './brain-layout';
import { BrainScene } from './brain-scene';

export const BRAIN_VIEW_TYPE = 'mcp-brain-view';

export class BrainView extends ItemView {
  navigation = false;
  private scene?: BrainScene;
  private observer?: ResizeObserver;
  private generation = 0;
  private closed = false;
  private cache = new Map<string, { at: number; token: string; data: GraphResponse }>();
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: RelatedPlugin
  ) {
    super(leaf);
  }
  getViewType(): string {
    return BRAIN_VIEW_TYPE;
  }
  getDisplayText(): string {
    return 'Brain';
  }
  getIcon(): string {
    return 'brain';
  }
  async onOpen(): Promise<void> {
    this.closed = false;
    this.contentEl.addClass('mcp-brain-view');
    await this.reload();
  }
  async onClose(): Promise<void> {
    this.closed = true;
    this.generation++;
    this.teardown();
    this.cache.clear();
    this.contentEl.empty();
  }
  invalidate(): void {
    this.cache.clear();
    void this.reload();
  }
  private teardown(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.scene?.dispose();
    this.scene = undefined;
  }
  async reload(refresh = false): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.teardown();
    this.contentEl.empty();
    const stage = this.contentEl.createDiv({ cls: 'mcp-brain-stage' });
    const header = this.contentEl.createDiv({ cls: 'mcp-brain-header' });
    const counts = header.createSpan({ text: 'Loading…' });
    const button = header.createEl('button', { text: 'Refresh' });
    button.addEventListener('click', () => {
      void this.reload(true);
    });
    const { serverUrl } = this.plugin.settings;
    const token = this.plugin.token();
    const url = serverUrl.replace(/\/+$/, '');
    if (!url || !token) {
      counts.setText('Set the server URL and token in settings');
      return;
    }
    if (refresh) this.cache.delete(url);
    try {
      const cached = this.cache.get(url);
      const hit = cached && cached.token === token && Date.now() - cached.at < 10 * 60 * 1000;
      const data = hit ? cached.data : await fetchGraph(url, token);
      if (this.closed || generation !== this.generation) return;
      if (!hit) this.cache.set(url, { at: Date.now(), token, data });
      const model = buildModel(data);
      const positions = layout(model);
      const scene = new BrainScene(stage, model, positions);
      this.scene = scene;
      counts.setText(
        `${data.nodes.length} notes · ${data.links.length} links · ${data.trails.length} trails`
      );
      const legend = this.contentEl.createDiv({ cls: 'mcp-brain-legend' });
      for (const [index, [action, description]] of [
        ['drag', 'rotate'],
        ['scroll', 'zoom'],
        ['hover', 'trace connections'],
        ['click', 'open note'],
      ].entries()) {
        if (index) legend.appendText(' · ');
        legend.createEl('b', { text: action });
        legend.appendText(` ${description}`);
      }
      legend.appendText(' · colour = lobe (hub) · brightness = heat · impulses = read together');
      const tooltip = this.contentEl.createDiv({ cls: 'mcp-brain-tooltip' });
      const title = tooltip.createDiv();
      const details = tooltip.createEl('small');
      const labels = model.lobesBySize.slice(0, 14).map(hub => {
        const el = this.contentEl.createDiv({ cls: 'mcp-brain-lobe', text: hub.title });
        el.style.color = model.lobeColor.get(hub) ?? '#8590c0';
        return { index: hub.i, el };
      });
      let hovered: number | null = null;
      scene.onHover = (index, screen) => {
        hovered = index;
        const node = index === null ? null : model.nodes[index];
        tooltip.style.opacity = node ? '1' : '0';
        if (!node) return;
        title.setText(node.title);
        details.setText(
          [
            node.lobe && node.lobe !== node ? node.lobe.title : '',
            node.type,
            `heat ${node.heat}`,
            `${model.neighbours.get(node)?.size ?? 0} connections`,
          ]
            .filter(Boolean)
            .join(' · ')
        );
        const rect = stage.getBoundingClientRect();
        const viewRect = this.contentEl.getBoundingClientRect();
        tooltip.style.left = `${rect.left - viewRect.left + screen.x + 16}px`;
        tooltip.style.top = `${rect.top - viewRect.top + screen.y + 14}px`;
      };
      scene.onOpen = (index, newTab) => {
        const node = model.nodes[index];
        if (node) void this.app.workspace.openLinkText(node.path, '', newTab);
      };
      scene.onFrame = () => {
        scene.setPaused(
          !this.containerEl.isShown() || this.contentEl.ownerDocument.visibilityState === 'hidden'
        );
        const node = hovered === null ? null : model.nodes[hovered];
        for (const anchor of scene.labelAnchors()) {
          const label = labels.find(item => item.index === anchor.index);
          if (!label) continue;
          label.el.style.left = `${anchor.x}px`;
          label.el.style.top = `${anchor.y}px`;
          label.el.style.opacity = String(
            !anchor.visible
              ? 0
              : node
                ? node.lobe?.i === anchor.index
                  ? 1
                  : 0.08
                : anchor.depthFade
          );
        }
      };
      this.observer = new ResizeObserver(() => scene.resize(stage.clientWidth, stage.clientHeight));
      this.observer.observe(stage);
      scene.onFrame();
    } catch (error) {
      if (this.closed || generation !== this.generation) return;
      this.teardown();
      stage.empty();
      const status = error instanceof RelatedError ? error.status : 0;
      counts.setText(
        status === 401 || status === 403 ? 'Authentication failed' : 'Brain server unreachable'
      );
    }
  }
}
