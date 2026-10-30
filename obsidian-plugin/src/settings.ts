import { PluginSettingTab, Setting } from 'obsidian';
import type { App } from 'obsidian';
import type RelatedPlugin from './main';

export interface RelatedSettings {
  serverUrl: string;
  k: number;
  autoOpen: boolean;
}
export const DEFAULT_SETTINGS: RelatedSettings = { serverUrl: '', k: 8, autoOpen: true };
export const TOKEN_KEY = 'mcp-related-notes-token';

export class RelatedSettingsTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: RelatedPlugin
  ) {
    super(app, plugin);
  }
  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName('Server URL').addText(text =>
      text
        .setPlaceholder('https://server.example')
        .setValue(this.plugin.settings.serverUrl)
        .onChange(async value => {
          this.plugin.settings.serverUrl = value.trim();
          await this.plugin.saveSettings();
        })
    );
    new Setting(this.containerEl)
      .setName('Token')
      .setDesc('Stored only on this device.')
      .addText(text => {
        text.inputEl.type = 'password';
        text.setValue(this.plugin.token()).onChange(value => {
          this.app.saveLocalStorage(TOKEN_KEY, value);
          this.plugin.settingsChanged();
        });
      });
    new Setting(this.containerEl).setName('Results per section').addSlider(slider =>
      slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.k)
        .setDynamicTooltip()
        .onChange(async value => {
          this.plugin.settings.k = value;
          await this.plugin.saveSettings();
        })
    );
    new Setting(this.containerEl).setName('Open on startup').addToggle(toggle =>
      toggle.setValue(this.plugin.settings.autoOpen).onChange(async value => {
        this.plugin.settings.autoOpen = value;
        await this.plugin.saveSettings();
      })
    );
  }
}
