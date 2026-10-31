import { Plugin } from 'obsidian';
import { RelatedView, VIEW_TYPE } from './view';
import { BrainView, BRAIN_VIEW_TYPE } from './brain-view';
import { DEFAULT_SETTINGS, RelatedSettingsTab, TOKEN_KEY, type RelatedSettings } from './settings';

export default class RelatedPlugin extends Plugin {
  settings: RelatedSettings = { ...DEFAULT_SETTINGS };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unloaded = false;
  token(): string {
    const value: unknown = this.app.loadLocalStorage(TOKEN_KEY);
    return typeof value === 'string' ? value : '';
  }
  async onload(): Promise<void> {
    const saved = await this.loadData();
    // Explicit allowlist prevents legacy or unexpected fields reaching data.json.
    this.settings = {
      serverUrl: typeof saved?.serverUrl === 'string' ? saved.serverUrl : '',
      k: Number.isInteger(saved?.k) && saved.k >= 1 && saved.k <= 20 ? saved.k : 8,
      autoOpen: typeof saved?.autoOpen === 'boolean' ? saved.autoOpen : true,
    };
    this.registerView(VIEW_TYPE, leaf => new RelatedView(leaf, this));
    this.registerView(BRAIN_VIEW_TYPE, leaf => new BrainView(leaf, this));
    this.addRibbonIcon('brain', 'Open brain view', () => {
      void this.openBrainView();
    });
    this.addCommand({
      id: 'open-brain-view',
      name: 'Open brain view',
      callback: () => {
        void this.openBrainView();
      },
    });
    this.addSettingTab(new RelatedSettingsTab(this.app, this));
    this.addCommand({
      id: 'open-view',
      name: 'Open related notes',
      callback: () => {
        void this.openView();
      },
    });
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.schedule()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.schedule()));
    this.app.workspace.onLayoutReady(() => {
      if (
        !this.unloaded &&
        this.settings.autoOpen &&
        !this.app.workspace.getLeavesOfType(VIEW_TYPE).length
      )
        void this.openView();
    });
  }
  onunload(): void {
    this.unloaded = true;
    clearTimeout(this.timer);
  }
  async saveSettings(): Promise<void> {
    const { serverUrl, k, autoOpen } = this.settings;
    await this.saveData({ serverUrl, k, autoOpen });
    this.settingsChanged();
  }
  settingsChanged(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof RelatedView) leaf.view.invalidate();
    }
    for (const leaf of this.app.workspace.getLeavesOfType(BRAIN_VIEW_TYPE)) {
      if (leaf.view instanceof BrainView) leaf.view.invalidate();
    }
    this.schedule();
  }
  private async openBrainView(): Promise<void> {
    if (this.unloaded) return;
    let leaf = this.app.workspace.getLeavesOfType(BRAIN_VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: BRAIN_VIEW_TYPE, active: true });
    }
    if (!this.unloaded) await this.app.workspace.revealLeaf(leaf);
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.unloaded) return;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof RelatedView) void leaf.view.reload();
      }
    }, 400);
  }
  private async openView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      const right = this.app.workspace.getRightLeaf(false);
      if (!right || this.unloaded) return;
      leaf = right;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    if (!this.unloaded) await this.app.workspace.revealLeaf(leaf);
  }
}
